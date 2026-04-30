import { readFileSync } from "node:fs"
import { basename, extname, resolve } from "node:path"
import { getApiBaseUrl, getAppBaseUrl } from "./config.js"
import type { LoadedConfig } from "./config-loader.js"

const API_BASE = getApiBaseUrl().replace(/\/$/, "")
const APP_BASE = getAppBaseUrl().replace(/\/$/, "")

/**
 * Demos must import the component via `@/components/ui/{slug}` because the
 * sandbox places the component at that path. We rewrite any import in the
 * user's demo file that resolves to the user's component file (regardless of
 * how they wrote it: `./button`, `../button`, `@/components/button` etc).
 */
function rewriteComponentImport(
  demoCode: string,
  demoAbsPath: string,
  componentAbsPath: string,
  slug: string,
): string {
  const demoDir = resolve(demoAbsPath, "..")
  const componentNoExt = componentAbsPath.replace(/\.(tsx|ts|jsx|js)$/i, "")

  return demoCode.replace(
    /from\s+(['"])([^'"\n]+)\1/g,
    (match, quote: string, importPath: string) => {
      // Skip bare-package imports
      if (!importPath.startsWith(".") && !importPath.startsWith("@/")) {
        return match
      }
      // Resolve aliased and relative imports against where they'd live in the
      // user's filesystem. We don't know the user's @/* alias mapping, so
      // treat `@/...` as a literal we leave alone unless it points at the
      // template default.
      if (importPath === "@/components/ui/component") {
        return `from ${quote}@/components/ui/${slug}${quote}`
      }
      if (!importPath.startsWith(".")) {
        return match
      }
      const resolved = resolve(demoDir, importPath).replace(
        /\.(tsx|ts|jsx|js)$/i,
        "",
      )
      if (resolved === componentNoExt) {
        return `from ${quote}@/components/ui/${slug}${quote}`
      }
      // Also handle the case where the user writes `from "./button"` with the
      // file existing as `button.tsx` — covered by the strip above.
      return match
    },
  )
}

// Surfaced for tests / debugging.
export const _internals = { rewriteComponentImport }

interface PublishResponse {
  success: boolean
  component_id: number
  is_new: boolean
  username: string
  slug: string
  url: string
  visibility: "team" | "public" | "private"
  install_ref: string
  demos: Array<{ id: number; slug: string }>
}

export interface PublishUploadResult {
  url: string
  componentId: number
  isNew: boolean
  visibility: "team" | "public" | "private"
  installRef: string
  demos: PublishResponse["demos"]
}

export async function publishToApi(
  apiKey: string,
  loaded: LoadedConfig,
): Promise<PublishUploadResult> {
  const { config, resolvedComponentPath, resolvedDemos } = loaded

  const previewIndexById = new Map<number, number>()
  const videoIndexById = new Map<number, number>()
  const previewBlobs: Array<{ blob: Blob; filename: string }> = []
  const videoBlobs: Array<{ blob: Blob; filename: string }> = []

  resolvedDemos.forEach((d, i) => {
    if (d.resolvedPreview) {
      previewIndexById.set(i, previewBlobs.length)
      previewBlobs.push({
        blob: fileToBlob(d.resolvedPreview, mimeForImage(d.resolvedPreview)),
        filename: basename(d.resolvedPreview),
      })
    }
    if (d.resolvedVideo) {
      videoIndexById.set(i, videoBlobs.length)
      videoBlobs.push({
        blob: fileToBlob(d.resolvedVideo, "video/mp4"),
        filename: basename(d.resolvedVideo),
      })
    }
  })

  const metadata = {
    name: config.name,
    slug: config.slug,
    description: config.description,
    registry: config.registry,
    license: config.license ?? "mit",
    visibility: config.visibility ?? "team",
    registry_slug: config.registry_slug,
    website_url: config.website_url,
    tags: config.tags,
    demos: resolvedDemos.map((d, i) => ({
      name: d.name,
      slug: d.slug,
      file_index: i,
      preview_index: previewIndexById.get(i),
      video_index: videoIndexById.get(i),
      tags: d.tags,
    })),
  }

  const form = new FormData()
  form.append("metadata", JSON.stringify(metadata))
  form.append(
    "component_code",
    fileToBlob(resolvedComponentPath, "text/plain"),
    basename(resolvedComponentPath),
  )
  const slugForRewrite = config.slug ?? metadata.slug ?? ""
  for (const d of resolvedDemos) {
    const raw = readFileSync(d.resolvedFile, "utf-8")
    const rewritten = slugForRewrite
      ? rewriteComponentImport(
          raw,
          d.resolvedFile,
          resolvedComponentPath,
          slugForRewrite,
        )
      : raw
    form.append(
      "demo_files",
      new Blob([rewritten], { type: "text/plain" }),
      basename(d.resolvedFile),
    )
  }
  for (const p of previewBlobs) {
    form.append("preview_images", p.blob, p.filename)
  }
  for (const v of videoBlobs) {
    form.append("preview_videos", v.blob, v.filename)
  }

  const res = await fetch(`${API_BASE}/components/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => "")
    let message = errBody
    try {
      const parsed = JSON.parse(errBody) as { message?: string; error?: string }
      message = parsed.message || parsed.error || errBody
    } catch {
      /* keep raw text */
    }
    throw new Error(
      `Publish failed (${res.status}): ${message || res.statusText}`,
    )
  }

  const json = (await res.json()) as PublishResponse
  return {
    componentId: json.component_id,
    isNew: json.is_new,
    visibility: json.visibility,
    installRef: json.install_ref,
    url: json.url || `${APP_BASE}/${json.username}/${json.slug}`,
    demos: json.demos,
  }
}

function fileToBlob(filePath: string, contentType: string): Blob {
  const buf = readFileSync(filePath)
  return new Blob([buf], { type: contentType })
}

function mimeForImage(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  return "image/png"
}
