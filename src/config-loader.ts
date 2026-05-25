import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { slugify, validateSlug } from "./utils.js"

export type Registry = "ui" | "hooks" | "blocks" | "icons"
export type Visibility = "unlisted" | "public" | "private"

export interface DemoEntry {
  name: string
  slug: string
  file: string
  preview?: string
  video?: string
  tags?: string[]
}

export interface PublishConfig {
  name: string
  slug?: string
  description: string
  registry: Registry
  license?: string
  visibility?: Visibility
  /** Optional team-Registry slug. Non-public CLI publishes use team default if omitted. */
  registry_slug?: string
  website_url?: string
  tags?: string[]
  component: string
  demos: DemoEntry[]
}

const VALID_REGISTRIES: Registry[] = ["ui", "hooks", "blocks", "icons"]
const VALID_VISIBILITIES: Visibility[] = ["unlisted", "public", "private"]

export interface LoadedConfig {
  rootDir: string
  config: PublishConfig
  resolvedComponentPath: string
  resolvedDemos: Array<DemoEntry & { resolvedFile: string; resolvedPreview?: string; resolvedVideo?: string }>
}

export function findConfigFile(startDir: string): string | null {
  const candidate = resolve(startDir, "21st.json")
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null
}

export function loadConfigFromFile(configPath: string): LoadedConfig {
  const rootDir = dirname(configPath)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"))
  } catch (e) {
    throw new Error(
      `Failed to parse ${configPath}: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  return validateAndResolve(parsed, rootDir)
}

export function buildConfigFromFlags(
  flags: {
    name: string
    slug?: string
    description: string
    registry: string
    license?: string
    visibility?: Visibility
    registry_slug?: string
    website_url?: string
    tags?: string[]
    component: string
    demos: string[]
    previews?: string[]
    videos?: string[]
  },
  rootDir: string,
): LoadedConfig {
  if (!VALID_REGISTRIES.includes(flags.registry as Registry)) {
    throw new Error(
      `--registry must be one of: ${VALID_REGISTRIES.join(", ")}`,
    )
  }
  const demos: DemoEntry[] = flags.demos.map((file, i) => {
    const baseName = file
      .split("/")
      .pop()!
      .replace(/\.(tsx|jsx|ts|js)$/i, "")
    return {
      name: titleCase(baseName),
      slug: slugify(baseName),
      file,
      preview: flags.previews?.[i],
      video: flags.videos?.[i],
    }
  })
  return validateAndResolve(
    {
      name: flags.name,
      slug: flags.slug,
      description: flags.description,
      registry: flags.registry,
      license: flags.license,
      visibility: flags.visibility,
      registry_slug: flags.registry_slug,
      website_url: flags.website_url,
      tags: flags.tags,
      component: flags.component,
      demos,
    },
    rootDir,
  )
}

function validateAndResolve(raw: unknown, rootDir: string): LoadedConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("Config must be a JSON object")
  }
  const obj = raw as Record<string, unknown>

  const name = expectString(obj, "name", { min: 2 })
  const description = expectString(obj, "description", { min: 10 })
  const registry = expectString(obj, "registry") as Registry
  if (!VALID_REGISTRIES.includes(registry)) {
    throw new Error(
      `registry must be one of: ${VALID_REGISTRIES.join(", ")}`,
    )
  }
  const componentRel = expectString(obj, "component")
  const demosRaw = obj.demos
  if (!Array.isArray(demosRaw) || demosRaw.length === 0) {
    throw new Error("config.demos must be a non-empty array")
  }

  let slug = obj.slug as string | undefined
  if (slug !== undefined) {
    const err = validateSlug(slug)
    if (err) throw new Error(`config.slug: ${err}`)
  } else {
    slug = slugify(name)
    const err = validateSlug(slug)
    if (err) throw new Error(`Auto-generated slug "${slug}" is invalid: ${err}`)
  }

  const tags = optStringArray(obj, "tags", { max: 5 })

  const demos: DemoEntry[] = demosRaw.map((d, i) => {
    if (!d || typeof d !== "object") {
      throw new Error(`config.demos[${i}] must be an object`)
    }
    const dd = d as Record<string, unknown>
    const dName = expectString(dd, "name", { min: 1 }, `demos[${i}].name`)
    const dSlug = expectString(dd, "slug", undefined, `demos[${i}].slug`)
    const slugErr = validateSlug(dSlug)
    if (slugErr) throw new Error(`demos[${i}].slug: ${slugErr}`)
    const dFile = expectString(dd, "file", undefined, `demos[${i}].file`)
    const dPreview = optString(dd, "preview")
    const dVideo = optString(dd, "video")
    const dTags = optStringArray(dd, "tags", { max: 10 })
    return {
      name: dName,
      slug: dSlug,
      file: dFile,
      preview: dPreview,
      video: dVideo,
      tags: dTags,
    }
  })

  // Reject duplicate demo slugs
  const seenSlugs = new Set<string>()
  for (const d of demos) {
    if (seenSlugs.has(d.slug)) {
      throw new Error(`Duplicate demo slug: "${d.slug}"`)
    }
    seenSlugs.add(d.slug)
  }

  const resolvedComponentPath = resolveExistingFile(rootDir, componentRel, "component")
  const resolvedDemos = demos.map((d, i) => ({
    ...d,
    resolvedFile: resolveExistingFile(rootDir, d.file, `demos[${i}].file`),
    resolvedPreview: d.preview
      ? resolveExistingFile(rootDir, d.preview, `demos[${i}].preview`)
      : undefined,
    resolvedVideo: d.video
      ? resolveExistingFile(rootDir, d.video, `demos[${i}].video`)
      : undefined,
  }))

  // Lightweight check: component must have a default export.
  const componentSrc = readFileSync(resolvedComponentPath, "utf-8")
  if (!/export\s+default\b/.test(componentSrc)) {
    throw new Error(
      `Component file ${componentRel} must contain a default export.`,
    )
  }

  // Visibility: explicit field is preferred. Legacy `is_public: true` is
  // mapped to `public`, otherwise default to `unlisted`.
  let visibility: Visibility = "unlisted"
  const visibilityRaw = optString(obj, "visibility")
  if (visibilityRaw) {
    if (!VALID_VISIBILITIES.includes(visibilityRaw as Visibility)) {
      throw new Error(
        `config.visibility must be one of: ${VALID_VISIBILITIES.join(", ")}`,
      )
    }
    visibility = visibilityRaw as Visibility
  } else if (optBoolean(obj, "is_public") === true) {
    visibility = "public"
  }

  return {
    rootDir,
    config: {
      name,
      slug,
      description,
      registry,
      license: optString(obj, "license") ?? "mit",
      visibility,
      registry_slug: optString(obj, "registry_slug"),
      website_url: optString(obj, "website_url"),
      tags,
      component: componentRel,
      demos,
    },
    resolvedComponentPath,
    resolvedDemos,
  }
}

function resolveExistingFile(rootDir: string, rel: string, label: string): string {
  const path = isAbsolute(rel) ? rel : resolve(rootDir, rel)
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label}: file not found at ${path}`)
  }
  return path
}

function expectString(
  obj: Record<string, unknown>,
  key: string,
  rule?: { min?: number },
  label = key,
): string {
  const val = obj[key]
  if (typeof val !== "string" || val.trim().length === 0) {
    throw new Error(`config.${label} is required and must be a non-empty string`)
  }
  if (rule?.min !== undefined && val.trim().length < rule.min) {
    throw new Error(`config.${label} must be at least ${rule.min} characters`)
  }
  return val.trim()
}

function optString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key]
  if (val === undefined || val === null) return undefined
  if (typeof val !== "string") {
    throw new Error(`config.${key} must be a string`)
  }
  return val.trim()
}

function optBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const val = obj[key]
  if (val === undefined || val === null) return undefined
  if (typeof val !== "boolean") {
    throw new Error(`config.${key} must be a boolean`)
  }
  return val
}

function optStringArray(
  obj: Record<string, unknown>,
  key: string,
  rule?: { max?: number },
): string[] | undefined {
  const val = obj[key]
  if (val === undefined || val === null) return undefined
  if (!Array.isArray(val) || !val.every((v) => typeof v === "string")) {
    throw new Error(`config.${key} must be an array of strings`)
  }
  const trimmed = (val as string[]).map((v) => v.trim()).filter(Boolean)
  if (rule?.max !== undefined && trimmed.length > rule.max) {
    throw new Error(`config.${key} accepts at most ${rule.max} entries`)
  }
  return trimmed
}

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}
