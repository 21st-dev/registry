import * as p from "@clack/prompts"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { CliAnalyticsMetadata } from "./analytics.js"
import { getApiBaseUrl } from "./config.js"
import { exitWithError } from "./exit.js"
import { getFlagValue, hasFlag, requireApiKey } from "./utils.js"

interface InstallResponse {
  install_ref: string
  name: string
  slug: string
  description: string
  registry: string
  visibility: string
  author: string
  files: Array<{ path: string; type: string; content: string; target?: string }>
  dependencies: string[]
  registry_dependencies: string[]
  index_css_url: string | null
  preview: {
    bundle_html_url: string | null
    preview_image_url: string | null
  } | null
}

const API_BASE = getApiBaseUrl().replace(/\/$/, "")

const REF_RE = /^@?([a-zA-Z0-9._-]+)\/([a-z0-9]([a-z0-9-]*[a-z0-9])?)$/

export async function add(args: string[]): Promise<CliAnalyticsMetadata | void> {
  const positional = args.find((a) => !a.startsWith("--"))
  if (!positional) {
    const message =
      "Usage: npx @21st-dev/registry add @user/slug   (e.g. @serjobas/animated-button)"
    p.log.error(message)
    exitWithError(message)
  }

  const ref = positional.replace(/^@/, "@") // normalise leading @
  const m = ref.match(REF_RE)
  if (!m) {
    const message = `Invalid component ref "${positional}". Expected @username/slug (e.g. @serjobas/animated-button).`
    p.log.error(message)
    exitWithError(message)
  }
  const [, username, slug] = m

  const apiKey = requireApiKey()
  const force = hasFlag(args, "--force") || hasFlag(args, "-f")
  const skipDeps = hasFlag(args, "--no-install") || hasFlag(args, "--skip-deps")
  const targetDir = getFlagValue(args, "--dir") ?? process.cwd()

  p.intro("@21st-dev/registry add")
  p.log.info(`Fetching ${ref}…`)

  const data = await fetchInstallData(apiKey, username!, slug!)

  p.log.info(`Component:   ${data.name} (by @${data.author})`)
  p.log.info(`Description: ${data.description}`)
  if (data.dependencies.length > 0) {
    p.log.info(`Dependencies: ${data.dependencies.join(", ")}`)
  }
  if (data.registry_dependencies.length > 0) {
    p.log.info(
      `Registry deps: ${data.registry_dependencies.join(", ")} ` +
        `(install separately with \`21st-registry add\`)`,
    )
  }

  const writtenPaths: string[] = []
  for (const file of data.files) {
    const rel = file.target ?? file.path
    const abs = resolve(targetDir, rel)
    if (existsSync(abs) && !force) {
      const message = `${rel} already exists. Use --force to overwrite, or move it aside.`
      p.log.warn(message)
      exitWithError(message)
    }
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, file.content, "utf-8")
    writtenPaths.push(rel)
  }

  for (const path of writtenPaths) {
    p.log.success(`Wrote ${path}`)
  }

  let packageManager: string | null = null
  if (!skipDeps && data.dependencies.length > 0) {
    packageManager = detectPackageManager(targetDir)
    p.log.info(`Installing npm deps with ${packageManager}…`)
    const cmd =
      packageManager === "pnpm"
        ? ["pnpm", "add", ...data.dependencies]
        : packageManager === "yarn"
          ? ["yarn", "add", ...data.dependencies]
          : packageManager === "bun"
            ? ["bun", "add", ...data.dependencies]
            : ["npm", "install", ...data.dependencies]
    const r = spawnSync(cmd[0]!, cmd.slice(1), {
      cwd: targetDir,
      stdio: "inherit",
    })
    if (r.status !== 0) {
      const message = `${packageManager} exited ${r.status}. Component files were written; install deps manually:`
      p.log.warn(message)
      p.log.info(`  ${cmd.join(" ")}`)
      exitWithError(message)
    }
  }

  if (data.preview?.bundle_html_url) {
    p.log.info(`Preview: ${data.preview.bundle_html_url}`)
  }
  p.outro(`✅ Added ${data.install_ref}`)

  return {
    author: data.author,
    component_slug: data.slug,
    dependencies_count: data.dependencies.length,
    files_count: data.files.length,
    force,
    install_ref: data.install_ref,
    package_manager: packageManager,
    skip_deps: skipDeps,
  }
}

async function fetchInstallData(
  apiKey: string,
  username: string,
  slug: string,
): Promise<InstallResponse> {
  const url = `${API_BASE}/components/install/${encodeURIComponent(
    username,
  )}/${encodeURIComponent(slug)}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    let msg = text
    try {
      const j = JSON.parse(text) as { message?: string; error?: string }
      msg = j.message || j.error || text
    } catch {
      /* keep raw */
    }
    throw new Error(`add failed (${res.status}): ${msg || res.statusText}`)
  }
  return (await res.json()) as InstallResponse
}

function detectPackageManager(
  cwd: string,
): "pnpm" | "yarn" | "npm" | "bun" {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn"
  if (existsSync(join(cwd, "bun.lockb"))) return "bun"
  // Check root package.json's `packageManager` field as a hint
  const pkgJson = join(cwd, "package.json")
  if (existsSync(pkgJson)) {
    try {
      const pm = (JSON.parse(readFileSync(pkgJson, "utf-8")) as { packageManager?: string })
        .packageManager
      if (pm?.startsWith("pnpm")) return "pnpm"
      if (pm?.startsWith("yarn")) return "yarn"
      if (pm?.startsWith("bun")) return "bun"
    } catch {
      /* ignore */
    }
  }
  return "npm"
}
