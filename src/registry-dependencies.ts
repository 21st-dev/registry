import { existsSync, readFileSync } from "node:fs"
import { basename, resolve, sep } from "node:path"

export interface ResolveRegistryDependenciesInput {
  refs: string[]
  cwd: string
  fetchImpl?: typeof fetch
}

export interface ResolvedRegistryDependencies {
  directDependencyUrls: string[]
  registryOwnedFiles: Map<string, string>
  registryItemsByUrl: Map<string, unknown>
}

interface ComponentsConfig {
  style?: string
  aliases?: Record<string, string>
  registries?: Record<string, RegistryConfig>
}

type RegistryConfig =
  | string
  | {
      url?: unknown
      headers?: unknown
      params?: unknown
    }

interface RegistryRequest {
  url: string
  registryDependency: string
  headers?: Record<string, string>
}

const DEFAULT_SHADCN_STYLE = "new-york"

const DEFAULT_ALIASES: Record<string, string> = {
  components: "src/components",
  ui: "src/components/ui",
  lib: "src/lib",
  hooks: "src/hooks",
}

export async function resolveRegistryDependencies({
  refs,
  cwd,
  fetchImpl = fetch,
}: ResolveRegistryDependenciesInput): Promise<ResolvedRegistryDependencies> {
  if (refs.length === 0) {
    return {
      directDependencyUrls: [],
      registryOwnedFiles: new Map(),
      registryItemsByUrl: new Map(),
    }
  }

  const components = loadComponentsConfig(cwd)
  const directRequests = refs.map((ref) => resolveRegistryRef(ref, components, cwd))
  const directDependencyUrls = directRequests.map(
    (request) => request.registryDependency,
  )
  const registryOwnedFiles = new Map<string, string>()
  const registryItemsByUrl = new Map<string, unknown>()
  const queue = [...directRequests]

  for (let i = 0; i < queue.length; i++) {
    const request = queue[i]!
    if (registryItemsByUrl.has(request.url)) continue

    const response = await fetchImpl(
      request.url,
      request.headers ? { headers: request.headers } : undefined,
    )
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(
        `Failed to fetch registry dependency ${request.url} (${response.status}): ${
          body || response.statusText
        }`,
      )
    }

    const item = assertRegistryItem(await response.json(), request.url)
    registryItemsByUrl.set(request.url, item)

    for (const file of getRegistryFiles(item)) {
      const ownedPath = getRegistryFileProjectPath(file, components)
      if (ownedPath) {
        registryOwnedFiles.set(ownedPath, request.url)
      }
    }

    for (const dependencyRef of getRegistryDependencies(item)) {
      queue.push(resolveRegistryRef(dependencyRef, components, cwd))
    }
  }

  return {
    directDependencyUrls,
    registryOwnedFiles,
    registryItemsByUrl,
  }
}

function resolveRegistryRef(
  ref: string,
  components: ComponentsConfig | null,
  cwd: string,
): RegistryRequest {
  const trimmed = ref.trim()
  if (isHttpUrl(trimmed)) {
    const url = new URL(trimmed).toString()
    return { url, registryDependency: url }
  }

  if (isBareShadcnRef(trimmed)) {
    return {
      url: `https://ui.shadcn.com/r/styles/${components?.style ?? DEFAULT_SHADCN_STYLE}/${trimmed}.json`,
      registryDependency: trimmed,
    }
  }

  const namespacedRef = parseNamespacedRegistryRef(trimmed)
  if (!namespacedRef) {
    throw new Error(
      `Unsupported registry dependency ref "${ref}". Supported refs are http(s) URLs and @namespace/name entries configured in components.json.`,
    )
  }

  if (!components) {
    throw new Error(
      `Cannot resolve registry dependency "${ref}" because components.json was not found in ${cwd}. Add a registries entry for ${namespacedRef.namespace}.`,
    )
  }

  const { namespace, name } = namespacedRef
  const registry = components.registries?.[namespace]
  if (!registry) {
    throw new Error(
      `Unknown registry namespace "${namespace}" for "${ref}". Add it to components.json under "registries".`,
    )
  }

  const template =
    typeof registry === "string"
      ? registry
      : typeof registry.url === "string"
        ? registry.url
        : undefined
  if (!template) {
    throw new Error(
      `Registry namespace "${namespace}" must be a URL string or an object with a string "url" field.`,
    )
  }

  const url = new URL(applyRegistryTemplate(template, name, components))
  if (!isHttpUrl(url.toString())) {
    throw new Error(
      `Registry namespace "${namespace}" for "${ref}" must resolve to an http(s) URL.`,
    )
  }
  for (const [key, value] of Object.entries(readStringRecord(registry, "params"))) {
    url.searchParams.set(key, applyRegistryTemplate(value, name, components))
  }

  const headers = Object.fromEntries(
    Object.entries(readStringRecord(registry, "headers")).map(([key, value]) => [
      key,
      applyRegistryTemplate(value, name, components),
    ]),
  )

  return {
    url: url.toString(),
    registryDependency: url.toString(),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

function isBareShadcnRef(ref: string): boolean {
  return (
    ref.length > 0 &&
    !ref.startsWith(".") &&
    !ref.includes("/") &&
    !ref.includes("\\") &&
    !ref.includes(" ")
  )
}

function parseNamespacedRegistryRef(
  ref: string,
): { namespace: string; name: string } | null {
  if (!ref.startsWith("@")) return null

  const parts = ref.split("/")
  if (parts.length !== 2) return null

  const [namespace, name] = parts
  if (!namespace || namespace === "@" || !name) return null

  return { namespace, name }
}

function loadComponentsConfig(cwd: string): ComponentsConfig | null {
  const path = resolve(cwd, "components.json")
  if (!existsSync(path)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"))
  } catch (error) {
    throw new Error(
      `Failed to parse components.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("components.json must be a JSON object")
  }
  return parsed as ComponentsConfig
}

function assertRegistryItem(value: unknown, url: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error(`Registry dependency ${url} did not return a JSON object.`)
  }
  const item = value as Record<string, unknown>
  if (typeof item.type !== "string" || !item.type.startsWith("registry:")) {
    throw new Error(
      `Registry dependency ${url} did not return a shadcn registry item. Expected a registry:* type.`,
    )
  }
  if (item.files !== undefined && !Array.isArray(item.files)) {
    throw new Error(`Registry dependency ${url} has an invalid "files" field.`)
  }
  if (
    item.registryDependencies !== undefined &&
    !Array.isArray(item.registryDependencies)
  ) {
    throw new Error(
      `Registry dependency ${url} has an invalid "registryDependencies" field.`,
    )
  }
  return item
}

function getRegistryFiles(
  item: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return Array.isArray(item.files)
    ? item.files.filter(
        (file): file is Record<string, unknown> =>
          !!file && typeof file === "object",
      )
    : []
}

function getRegistryDependencies(item: Record<string, unknown>): string[] {
  return Array.isArray(item.registryDependencies)
    ? item.registryDependencies.filter(
        (dependency): dependency is string => typeof dependency === "string",
      )
    : []
}

function getRegistryFileProjectPath(
  file: Record<string, unknown>,
  components: ComponentsConfig | null,
): string | null {
  const target = typeof file.target === "string" ? file.target : undefined
  const path = typeof file.path === "string" ? file.path : undefined
  if (target) return normalizeProjectPath(resolveTargetPath(target, components))
  if (!path) return null

  return getDefaultRegistryFileTargetPath(path, file, components)
}

function getDefaultRegistryFileTargetPath(
  path: string,
  file: Record<string, unknown>,
  components: ComponentsConfig | null,
): string | null {
  const fileName = basename(path)
  const type = typeof file.type === "string" ? file.type : undefined

  switch (type) {
    case "registry:ui":
      return normalizeProjectPath(
        `${aliasToProjectPath("ui", components)}/${fileName}`,
      )
    case "registry:component":
    case "registry:block":
      return normalizeProjectPath(
        `${aliasToProjectPath("components", components)}/${fileName}`,
      )
    case "registry:lib":
      return normalizeProjectPath(
        `${aliasToProjectPath("lib", components)}/${fileName}`,
      )
    case "registry:hook":
      return normalizeProjectPath(
        `${aliasToProjectPath("hooks", components)}/${fileName}`,
      )
    default:
      return null
  }
}

function resolveTargetPath(
  target: string,
  components: ComponentsConfig | null,
): string {
  if (target.startsWith("~/")) {
    return target.slice(2)
  }

  for (const aliasName of ["components", "ui", "lib", "hooks"]) {
    const prefix = `@${aliasName}/`
    if (target.startsWith(prefix)) {
      return `${aliasToProjectPath(aliasName, components)}/${target.slice(
        prefix.length,
      )}`
    }
  }

  if (target.startsWith("@")) {
    return target.slice(1)
  }

  return target
}

function aliasToProjectPath(
  aliasName: string,
  components: ComponentsConfig | null,
): string {
  const configured = components?.aliases?.[aliasName]
  if (!configured) return DEFAULT_ALIASES[aliasName] ?? aliasName

  if (configured.startsWith("@/")) {
    return `src/${configured.slice(2)}`
  }
  if (configured.startsWith("~/")) {
    return configured.slice(2)
  }
  if (configured.startsWith("/")) {
    return configured.slice(1)
  }
  return configured
}

function applyRegistryTemplate(
  value: string,
  name: string,
  components: ComponentsConfig,
): string {
  return value
    .replaceAll("{name}", name)
    .replaceAll("{style}", components.style ?? "")
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, envName: string) => {
      return process.env[envName] ?? ""
    })
}

function readStringRecord(
  registry: RegistryConfig,
  key: "headers" | "params",
): Record<string, string> {
  if (typeof registry === "string") return {}
  const value = registry[key]
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Registry "${key}" must be an object of string values.`)
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function normalizeProjectPath(path: string): string {
  return path
    .split(sep)
    .join("/")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
}
