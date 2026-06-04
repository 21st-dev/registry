import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, extname, resolve } from "node:path"
import { getApiBaseUrl, getAppBaseUrl } from "./config.js"
import type { LoadedConfig } from "./config-loader.js"
import { preprocessPublishFiles } from "./preprocess.js"

const API_BASE = getApiBaseUrl().replace(/\/$/, "")
const APP_BASE = getAppBaseUrl().replace(/\/$/, "")

interface PublishResponse {
  success: boolean
  component_id: number
  is_new: boolean
  username: string
  slug: string
  url: string
  visibility: "unlisted" | "public" | "private"
  install_ref: string
  demos: Array<{ id: number; slug: string }>
}

export interface PublishUploadResult {
  url: string
  componentId: number
  isNew: boolean
  visibility: "unlisted" | "public" | "private"
  installRef: string
  demos: PublishResponse["demos"]
}

export async function publishToApi(
  apiKey: string,
  loaded: LoadedConfig,
): Promise<PublishUploadResult> {
  const { config, resolvedComponentPath, resolvedDemos } = loaded
  const componentSlug = config.slug ?? ""
  const hasDefaultDemo = resolvedDemos.some((demo) => demo.slug === "default")
  const publishDemos = resolvedDemos.map((demo, index) => ({
    ...demo,
    slug: !hasDefaultDemo && index === 0 ? "default" : demo.slug,
  }))

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

  const preprocessed = preprocessPublishFiles({
    rootDir: loaded.rootDir,
    componentSlug,
    componentPath: resolvedComponentPath,
    demos: publishDemos.map((demo) => ({
      slug: demo.slug,
      file: demo.resolvedFile,
    })),
  })

  const metadata = {
    name: config.name,
    slug: config.slug,
    description: config.description,
    registry: config.registry,
    runtime: config.runtime,
    ...(config.runtime === "expo"
      ? getPackageDependencyMetadata(
          dirname(resolvedComponentPath),
          preprocessed.packageImports,
          preprocessed.componentPackageImports,
        )
      : {}),
    license: config.license ?? "mit",
    visibility: config.visibility ?? "unlisted",
    registry_slug: config.registry_slug,
    website_url: config.website_url,
    tags: config.tags,
    demos: publishDemos.map((d, i) => ({
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
    new Blob([preprocessed.componentCode], { type: "text/plain" }),
    basename(resolvedComponentPath),
  )
  for (const demo of preprocessed.demoCodes) {
    form.append(
      "demo_files",
      new Blob([demo.code], { type: "text/plain" }),
      `${demo.slug}.tsx`,
    )
  }
  for (const file of preprocessed.supportFiles) {
    form.append(
      file.includeInRegistry ? "component_support_files" : "demo_support_files",
      new Blob([file.bytes]),
      file.fileName,
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
    url: json.url || `${APP_BASE}/community/components/${json.username}/${json.slug}`,
    demos: json.demos,
  }
}

function getPackageDependencyMetadata(
  rootDir: string,
  packageImports: string[],
  componentPackageImports: string[],
): {
  dependencies?: Record<string, string>
  component_dependencies?: Record<string, string>
} {
  const packageJsonPath = findNearestPackageJson(rootDir)
  if (!packageJsonPath) return {}

  try {
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, "utf-8"),
    ) as {
      dependencies?: Record<string, string>
    }

    const importedPackages = new Set(packageImports)
    const importedComponentPackages = new Set(componentPackageImports)
    const dependencies = pickDependencies(
      packageJson.dependencies ?? {},
      importedPackages,
    )
    const componentDependencies = pickDependencies(
      packageJson.dependencies ?? {},
      importedComponentPackages,
    )
    return {
      ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
      ...(Object.keys(componentDependencies).length > 0
        ? { component_dependencies: componentDependencies }
        : {}),
    }
  } catch {
    return {}
  }
}

function pickDependencies(
  dependencies: Record<string, string>,
  packageImports: Set<string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([name]) => packageImports.has(name)),
  )
}

function findNearestPackageJson(startDir: string): string | null {
  let currentDir = resolve(startDir)
  while (true) {
    const candidate = resolve(currentDir, "package.json")
    if (existsSync(candidate)) {
      return candidate
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) return null
    currentDir = parentDir
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
