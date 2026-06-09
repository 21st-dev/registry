import * as p from "@clack/prompts"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"
import { tmpdir } from "node:os"
import type { CliAnalyticsMetadata } from "./analytics.js"
import { publishToApi } from "./api.js"
import {
  buildConfigFromFlags,
  findConfigFile,
  loadConfigFromFile,
  type LoadedConfig,
  type Visibility,
} from "./config-loader.js"
import { exitWithError } from "./exit.js"
import {
  getFlagValue,
  getRepeatedFlagValues,
  hasFlag,
  requireApiKey,
  slugify,
} from "./utils.js"

export async function publish(args: string[]): Promise<CliAnalyticsMetadata | void> {
  const apiKey = requireApiKey()
  const loaded = resolveConfig(args)

  p.intro("@21st-dev/registry")
  p.log.info(`Component:  ${loaded.config.name} (${loaded.config.slug})`)
  p.log.info(`Registry:   ${loaded.config.registry}`)
  p.log.info(`Runtime:    ${loaded.config.runtime}`)
  p.log.info(`Demos:      ${loaded.resolvedDemos.length}`)
  p.log.info(
    `Visibility: ${loaded.config.visibility ?? "unlisted"}${
      loaded.config.visibility === "public"
        ? " (will go through review)"
        : loaded.config.visibility === "private"
          ? " (registry team only)"
          : " (shareable link)"
    }`,
  )

  const s = p.spinner()
  s.start("Publishing… (~15-20s while the sandbox builds)")

  try {
    const result = await publishToApi(apiKey, loaded)
    s.stop(result.isNew ? "Published" : "Updated")
    p.log.success(`✅ ${result.url}`)
    p.log.info(`Install in another project:`)
    p.log.info(`  npx @21st-dev/registry add ${result.installRef}`)
    p.outro("Done")
    return {
      component_id: result.componentId,
      demos_count: loaded.resolvedDemos.length,
      has_preview: loaded.resolvedDemos.some((demo) => !!demo.resolvedPreview),
      has_registry_dependencies:
        (loaded.config.registry_dependencies ?? []).length > 0,
      is_new: result.isNew,
      registry: loaded.config.registry,
      runtime: loaded.config.runtime,
      visibility: result.visibility,
    }
  } catch (e) {
    s.stop("Publish failed")
    const message = e instanceof Error ? e.message : String(e)
    p.log.error(message)
    exitWithError(message)
  }
}

function resolveConfig(args: string[]): LoadedConfig {
  // Allow either a 21st.json (or a directory holding one) OR a single
  // component file path positionally — the latter triggers the auto-detect
  // path so users don't have to scaffold any json.
  const positional = args[0]?.startsWith("--") ? undefined : args[0]
  const explicitComponent = getFlagValue(args, "--component")

  if (explicitComponent !== undefined) {
    // Fully flag-driven (good for agents)
    return resolveConfigFromFlags(args, explicitComponent)
  }

  if (positional && extname(positional)) {
    // Looks like a file path → single-file fast path
    return resolveSingleFilePath(positional, args)
  }

  // Fall back to 21st.json convention
  const cwd = positional
    ? isAbsolute(positional)
      ? positional
      : resolve(process.cwd(), positional)
    : process.cwd()
  const configPath = findConfigFile(cwd)
  if (!configPath) {
    throw new Error(
      `No 21st.json found in ${cwd}. Quick options:\n` +
        `  21st-registry ./Button.tsx --name "Button" --description "..."\n` +
        `  21st-registry init   # scaffold a 21st.json starter`,
    )
  }
  const loaded = loadConfigFromFile(configPath)
  return applyPublishFlagOverrides(loaded, args)
}

/**
 * Single-file fast path: `21st-registry ./Button.tsx`.
 * Infer name from default export, slug from filename, generate a trivial demo
 * if none is provided.
 */
function resolveSingleFilePath(
  rel: string,
  args: string[],
): LoadedConfig {
  const componentPath = isAbsolute(rel) ? rel : resolve(process.cwd(), rel)
  if (!existsSync(componentPath) || !statSync(componentPath).isFile()) {
    throw new Error(`Component file not found: ${componentPath}`)
  }
  const source = readFileSync(componentPath, "utf-8")
  const detectedName = detectComponentName(source) ?? basenameNoExt(componentPath)
  const detectedTags = detectTagsFromImports(source)

  const name = getFlagValue(args, "--name") ?? humanise(detectedName)
  const description =
    getFlagValue(args, "--description") ?? extractJsDocSummary(source) ?? ""
  if (description.length < 10) {
    throw new Error(
      `--description "..." is required (min 10 chars) — give a 1-2 sentence summary of what the component does.`,
    )
  }
  const slug = getFlagValue(args, "--slug") ?? slugify(detectedName)
  const tagsRaw = getFlagValue(args, "--tags")
  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : detectedTags

  const explicitDemo = getRepeatedFlagValues(args, "--demo")
  const demoFiles = explicitDemo.length
    ? explicitDemo
    : autoFindDemo(componentPath, slug)

  const previews = getRepeatedFlagValues(args, "--preview")
  const videos = getRepeatedFlagValues(args, "--video")

  const rootDir = findProjectRoot(componentPath)

  return buildConfigFromFlags(
    {
      name,
      slug,
      description,
      registry: (getFlagValue(args, "--registry") ?? "ui").toLowerCase(),
      runtime: getFlagValue(args, "--runtime")?.toLowerCase(),
      license: getFlagValue(args, "--license"),
      visibility: pickVisibility(args),
      registry_slug: getFlagValue(args, "--to"),
      website_url: getFlagValue(args, "--website"),
      tags: tags && tags.length > 0 ? tags : undefined,
      registry_dependencies: getRepeatedFlagValues(args, "--registry-dep"),
      component: componentPath,
      demos: demoFiles,
      previews: previews.length ? previews : undefined,
      videos: videos.length ? videos : undefined,
    },
    rootDir,
  )
}

export function findProjectRoot(componentPath: string): string {
  let currentDir = dirname(resolve(componentPath))

  while (true) {
    if (
      existsSync(join(currentDir, "components.json")) ||
      existsSync(join(currentDir, "tsconfig.json")) ||
      existsSync(join(currentDir, "package.json"))
    ) {
      return currentDir
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return dirname(resolve(componentPath))
    }
    currentDir = parentDir
  }
}

function resolveConfigFromFlags(
  args: string[],
  componentPath: string,
): LoadedConfig {
  const get = (flag: string) => getFlagValue(args, flag)

  const required = (flag: string): string => {
    const v = get(flag)
    if (!v) throw new Error(`Missing required flag: ${flag}`)
    return v
  }

  const componentAbs = isAbsolute(componentPath)
    ? componentPath
    : resolve(process.cwd(), componentPath)

  const source = readFileSync(componentAbs, "utf-8")
  const detectedName = detectComponentName(source) ?? basenameNoExt(componentAbs)

  const name = get("--name") ?? humanise(detectedName)
  const description = required("--description")
  const slug = get("--slug") ?? slugify(detectedName)

  const explicitDemo = getRepeatedFlagValues(args, "--demo")
  const demos = explicitDemo.length
    ? explicitDemo
    : autoFindDemo(componentAbs, slug)

  const tagsRaw = get("--tags")
  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : detectTagsFromImports(source)

  const previews = getRepeatedFlagValues(args, "--preview")
  const videos = getRepeatedFlagValues(args, "--video")

  return buildConfigFromFlags(
    {
      name,
      slug,
      description,
      registry: (get("--registry") ?? "ui").toLowerCase(),
      runtime: get("--runtime")?.toLowerCase(),
      license: get("--license"),
      visibility: pickVisibility(args),
      registry_slug: get("--to"),
      website_url: get("--website"),
      tags: tags && tags.length > 0 ? tags : undefined,
      registry_dependencies: getRepeatedFlagValues(args, "--registry-dep"),
      component: componentAbs,
      demos,
      previews: previews.length ? previews : undefined,
      videos: videos.length ? videos : undefined,
    },
    process.cwd(),
  )
}

function applyPublishFlagOverrides(
  loaded: LoadedConfig,
  args: string[],
): LoadedConfig {
  const runtime = getFlagValue(args, "--runtime")
  const registryDeps = getRepeatedFlagValues(args, "--registry-dep")
  if (!runtime && registryDeps.length === 0) return loaded

  return {
    ...loaded,
    config: {
      ...loaded.config,
      ...(runtime ? { runtime: parseRuntimeFlag(runtime) } : {}),
      registry_dependencies:
        registryDeps.length > 0
          ? [...(loaded.config.registry_dependencies ?? []), ...registryDeps]
          : loaded.config.registry_dependencies,
    },
  }
}

function pickVisibility(args: string[]): Visibility | undefined {
  if (hasFlag(args, "--public")) return "public"
  if (hasFlag(args, "--unlisted")) return "unlisted"
  if (hasFlag(args, "--private")) return "private"
  if (hasFlag(args, "--team")) {
    throw new Error("--team is no longer supported. Use --unlisted instead.")
  }
  const explicit = getFlagValue(args, "--visibility")
  if (
    explicit === "unlisted" ||
    explicit === "public" ||
    explicit === "private"
  ) {
    return explicit
  }
  if (explicit) {
    throw new Error("--visibility must be one of: unlisted, public, private")
  }
  return undefined // config-loader defaults to "unlisted"
}

function parseRuntimeFlag(runtime: string) {
  const normalized = runtime.toLowerCase()
  if (normalized !== "react" && normalized !== "expo") {
    throw new Error("--runtime must be one of: react, expo")
  }
  return normalized
}

/**
 * Find a demo file next to the component, or generate a trivial one in /tmp.
 *
 * Lookup order:
 *  1. {Component}.demo.tsx next to the component file
 *  2. demos/{slug}.tsx | demos/default.tsx in the same dir
 *  3. ../demos/{slug}.tsx | ../demos/default.tsx
 *  4. fallback — create a 1-line `<Component />` demo in os.tmpdir()
 */
function autoFindDemo(componentPath: string, slug: string): string[] {
  const dir = dirname(componentPath)
  const noExt = basenameNoExt(componentPath)
  const candidates = [
    join(dir, `${noExt}.demo.tsx`),
    join(dir, "demos", `${slug}.tsx`),
    join(dir, "demos", "default.tsx"),
    join(dir, "..", "demos", `${slug}.tsx`),
    join(dir, "..", "demos", "default.tsx"),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return [candidate]
    }
  }
  // Synthesize a trivial demo. The CLI will rewrite the import to
  // @/components/ui/{slug}, so the relative `../component` is just a marker.
  const tmpDir = join(tmpdir(), `21st-registry-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  const demoPath = join(tmpDir, "default.tsx")
  const componentName = toComponentIdentifier(noExt)
  writeFileSync(
    demoPath,
    `import ${componentName} from "${relativeToImportRef(componentPath, demoPath)}"

export default function Demo() {
  return <${componentName} />
}
`,
  )
  return [demoPath]
}

/**
 * Compute the relative import specifier from `from` (a generated demo file)
 * to `to` (the user's component file).
 */
function relativeToImportRef(to: string, from: string): string {
  let rel = relative(dirname(from), to).replace(/\\/g, "/")
  rel = rel.replace(/\.(tsx|ts|jsx|js)$/i, "")
  if (!rel.startsWith(".")) rel = "./" + rel
  return rel
}

function detectComponentName(source: string): string | undefined {
  const re1 = /export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/
  const re2 = /export\s+default\s+(?:React\.)?(?:memo|forwardRef)\(\s*function\s+([A-Z][A-Za-z0-9_]*)/
  const re3 = /export\s+default\s+([A-Z][A-Za-z0-9_]*)/
  return (
    source.match(re1)?.[1] ??
    source.match(re2)?.[1] ??
    source.match(re3)?.[1]
  )
}

function extractJsDocSummary(source: string): string | undefined {
  const m = source.match(/\/\*\*([\s\S]*?)\*\//)
  if (!m) return undefined
  const lines = m[1]!.split(/\r?\n/).map((line) =>
    line
      .replace(/^\s*\*\s?/, "")
      .replace(/^@\w+\s.*/, "")
      .trim(),
  )
  const summary = lines.filter(Boolean).join(" ").trim()
  return summary.length >= 10 ? summary : undefined
}

const TAG_HINT_FROM_PACKAGE: Record<string, string> = {
  "lucide-react": "icon",
  "framer-motion": "animation",
  "@radix-ui/react-dialog": "dialog",
  "@radix-ui/react-dropdown-menu": "dropdown",
  "@radix-ui/react-select": "select",
  "@radix-ui/react-tabs": "tabs",
  "@radix-ui/react-tooltip": "tooltip",
  "@radix-ui/react-popover": "popover",
  "@radix-ui/react-accordion": "accordion",
  "@radix-ui/react-checkbox": "checkbox",
  "@radix-ui/react-switch": "switch",
  "react-hook-form": "form",
  zod: "form",
  recharts: "chart",
}

function detectTagsFromImports(source: string): string[] {
  const re = /import\s+(?:[^"'\n]+from\s+)?["']([^"']+)["']/g
  const tags = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const pkg = m[1]!
    if (pkg.startsWith(".") || pkg.startsWith("@/")) continue
    const tag = TAG_HINT_FROM_PACKAGE[pkg]
    if (tag) tags.add(tag)
  }
  return [...tags].slice(0, 5)
}

function basenameNoExt(p: string): string {
  return basename(p).replace(/\.(tsx|ts|jsx|js)$/i, "")
}

function humanise(s: string): string {
  // "spike-button" → "Spike Button"; "AnimatedButton" → "Animated Button"
  return s
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
}

function toComponentIdentifier(seed: string): string {
  const name = humanise(seed)
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9_$]/g, "")

  if (!name) return "Component"
  if (/^[A-Za-z_$]/.test(name)) return name
  return `Component${name}`
}
