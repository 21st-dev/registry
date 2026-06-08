import { existsSync, readFileSync, statSync } from "node:fs"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path"
import { Project, ts } from "ts-morph"

export interface PreprocessDemoInput {
  slug: string
  file: string
}

export interface PreprocessPublishFilesInput {
  rootDir: string
  componentSlug: string
  componentPath: string
  demos: PreprocessDemoInput[]
  registryOwnedFiles?: Map<string, string>
}

export interface PreprocessedDemoFile {
  slug: string
  code: string
}

export interface PreprocessedSupportFile {
  fileName: string
  bytes: Uint8Array
  includeInRegistry: boolean
}

export interface PreprocessedPublishFiles {
  componentCode: string
  demoCodes: PreprocessedDemoFile[]
  supportFiles: PreprocessedSupportFile[]
  packageImports: string[]
  componentPackageImports: string[]
  registryDependencies: string[]
  excludedRegistryFiles: Array<{ path: string; ownerUrl: string }>
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"])
const RESOLVE_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".json",
  ".module.css",
  ".css",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".ico",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
]
const PROJECT_CONFIG_FILES = new Set(["components.json", "21st-registry.json"])

interface InternalSupportFile extends PreprocessedSupportFile {
  targetPath: string
}

export function preprocessPublishFiles(
  input: PreprocessPublishFilesInput,
): PreprocessedPublishFiles {
  const rootDir = resolve(input.rootDir)
  const componentPath = resolve(input.componentPath)
  const demoInputs = input.demos.map((demo) => ({
    slug: demo.slug,
    file: resolve(demo.file),
  }))
  const project = createProject(rootDir)
  const componentTargetPath = `src/components/ui/${input.componentSlug}.tsx`
  const supportTargetDir = `src/components/ui/${input.componentSlug}-utils`
  const demoSourcePaths = new Set(demoInputs.map((demo) => demo.file))
  const supportBySource = new Map<string, InternalSupportFile>()
  const supportSourceByName = new Map<string, string>()
  const supportQueue: string[] = []
  const packageImports = new Set<string>()
  const componentPackageImports = new Set<string>()
  const registryDependencies = new Set<string>()
  const excludedRegistryFiles = new Map<string, string>()
  const registryOwnedFiles = normalizeRegistryOwnedFiles(input.registryOwnedFiles)

  function ensureSupportFile(
    sourcePath: string,
    includeInRegistry: boolean,
  ): InternalSupportFile {
    const normalizedSourcePath = resolve(sourcePath)
    const existing = supportBySource.get(normalizedSourcePath)
    if (existing) {
      existing.includeInRegistry ||= includeInRegistry
      return existing
    }

    assertInsideRoot(rootDir, normalizedSourcePath)
    assertNotProjectConfigFile(rootDir, normalizedSourcePath)
    const fileName = basename(normalizedSourcePath)
    const previousSource = supportSourceByName.get(fileName)
    if (previousSource && previousSource !== normalizedSourcePath) {
      throw new Error(
        `Cannot publish local dependency "${normalizedSourcePath}" because "${fileName}" is also imported from "${previousSource}". Rename one of these files before publishing.`,
      )
    }

    supportSourceByName.set(fileName, normalizedSourcePath)
    const supportFile = {
      fileName,
      targetPath: `${supportTargetDir}/${fileName}`,
      bytes: new Uint8Array(),
      includeInRegistry,
    }
    supportBySource.set(normalizedSourcePath, supportFile)
    supportQueue.push(normalizedSourcePath)
    return supportFile
  }

  function excludeRegistryFile(
    sourcePath: string,
  ): { projectPath: string; ownerUrl: string } | undefined {
    const ownerUrl = getRegistryOwnerUrl(rootDir, sourcePath, registryOwnedFiles)
    if (!ownerUrl) return undefined

    const projectPath = toProjectRelativePath(rootDir, sourcePath)
    registryDependencies.add(ownerUrl)
    excludedRegistryFiles.set(projectPath, ownerUrl)
    return { projectPath, ownerUrl }
  }

  function rewriteSpecifier(
    sourcePath: string,
    sourceTargetPath: string,
    specifier: string,
    includeInRegistry: boolean,
    tsResolvedPath?: string,
  ): string {
    if (specifier === "@/components/ui/component") {
      return `@/components/ui/${input.componentSlug}`
    }

    if (isExternalSpecifier(specifier)) {
      const packageName = getPackageName(specifier)
      packageImports.add(packageName)
      if (includeInRegistry) {
        componentPackageImports.add(packageName)
      }
      return specifier
    }

    const resolved = resolveImportSpecifier(
      rootDir,
      sourcePath,
      specifier,
      tsResolvedPath,
    )
    if (!resolved) return specifier

    if (resolved.path === componentPath) {
      return `@/components/ui/${input.componentSlug}${resolved.suffix}`
    }

    const registryFile = excludeRegistryFile(resolved.path)
    if (registryFile) {
      return toRelativeImport(
        sourceTargetPath,
        registryFile.projectPath,
        CODE_EXTENSIONS.has(extname(resolved.path).toLowerCase()),
        resolved.suffix,
      )
    }

    if (specifier.startsWith("@/components/ui/")) {
      return specifier
    }

    if (demoSourcePaths.has(resolved.path)) {
      return specifier
    }

    const supportFile = ensureSupportFile(resolved.path, includeInRegistry)
    return toRelativeImport(
      sourceTargetPath,
      supportFile.targetPath,
      CODE_EXTENSIONS.has(extname(resolved.path).toLowerCase()),
      resolved.suffix,
    )
  }

  function rewriteCodeFile(
    sourcePath: string,
    sourceTargetPath: string,
    includeInRegistry: boolean,
  ): string {
    const sourceFile = getSourceFile(project, sourcePath)

    for (const declaration of sourceFile.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue()
      const rewritten = rewriteSpecifier(
        sourcePath,
        sourceTargetPath,
        specifier,
        includeInRegistry,
        declaration.getModuleSpecifierSourceFile()?.getFilePath(),
      )
      if (rewritten !== specifier) {
        declaration.setModuleSpecifier(rewritten)
      }
    }

    for (const declaration of sourceFile.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue()
      if (!specifier) continue

      const rewritten = rewriteSpecifier(
        sourcePath,
        sourceTargetPath,
        specifier,
        includeInRegistry,
        declaration.getModuleSpecifierSourceFile()?.getFilePath(),
      )
      if (rewritten !== specifier) {
        declaration.setModuleSpecifier(rewritten)
      }
    }

    return sourceFile.getText()
  }

  const componentCode = rewriteCodeFile(componentPath, componentTargetPath, true)
  const demoCodes = demoInputs.map((demo) => ({
    slug: demo.slug,
    code: rewriteCodeFile(demo.file, `src/demos/${demo.slug}.tsx`, false),
  }))

  for (let i = 0; i < supportQueue.length; i++) {
    const sourcePath = supportQueue[i]!
    const supportFile = supportBySource.get(sourcePath)!
    const extension = extname(sourcePath).toLowerCase()

    if (CODE_EXTENSIONS.has(extension)) {
      supportFile.bytes = textToBytes(
        rewriteCodeFile(
          sourcePath,
          supportFile.targetPath,
          supportFile.includeInRegistry,
        ),
      )
    } else if (extension === ".css") {
      supportFile.bytes = textToBytes(
        rewriteCssFile(
          rootDir,
          sourcePath,
          supportFile.targetPath,
          supportFile.includeInRegistry,
          ensureSupportFile,
          excludeRegistryFile,
        ),
      )
    } else {
      supportFile.bytes = readFileSync(sourcePath)
    }
  }

  return {
    componentCode,
    demoCodes,
    supportFiles: [...supportBySource.values()].sort((a, b) =>
      a.targetPath.localeCompare(b.targetPath),
    ).map((file) => ({
      fileName: file.fileName,
      bytes: file.bytes,
      includeInRegistry: file.includeInRegistry,
    })),
    packageImports: [...packageImports].sort(),
    componentPackageImports: [...componentPackageImports].sort(),
    registryDependencies: [...registryDependencies].sort(),
    excludedRegistryFiles: [...excludedRegistryFiles.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, ownerUrl]) => ({ path, ownerUrl })),
  }
}

function createProject(rootDir: string): Project {
  const tsConfigFilePath = resolve(rootDir, "tsconfig.json")
  if (existsSync(tsConfigFilePath)) {
    return new Project({
      tsConfigFilePath,
      skipAddingFilesFromTsConfig: true,
    })
  }

  return new Project({
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      baseUrl: rootDir,
      paths: {
        "@/*": ["src/*"],
      },
    },
  })
}

function getSourceFile(project: Project, sourcePath: string) {
  const existing = project.getSourceFile(sourcePath)
  if (existing) return existing
  return project.addSourceFileAtPath(sourcePath)
}

function resolveImportSpecifier(
  rootDir: string,
  sourcePath: string,
  specifier: string,
  tsResolvedPath?: string,
): { path: string; suffix: string } | null {
  if (isExternalSpecifier(specifier)) return null

  const { path: specifierPath, suffix } = splitSpecifierSuffix(specifier)
  let resolvedPath = tsResolvedPath ? resolve(tsResolvedPath) : null

  if (!resolvedPath) {
    let basePath: string | null = null
    if (specifierPath.startsWith(".")) {
      basePath = resolve(dirname(sourcePath), specifierPath)
    } else if (specifierPath.startsWith("/")) {
      basePath = resolve(rootDir, specifierPath.slice(1))
    } else if (specifierPath.startsWith("@/")) {
      basePath = resolve(rootDir, "src", specifierPath.slice(2))
    }

    resolvedPath = basePath ? resolveExistingModule(basePath) : null
  }

  if (!resolvedPath) {
    if (specifierPath.startsWith(".") || specifierPath.startsWith("/")) {
      throw new Error(
        `Unable to resolve local import "${specifier}" from "${sourcePath}"`,
      )
    }
    return null
  }

  assertInsideRoot(rootDir, resolvedPath)
  return { path: resolvedPath, suffix }
}

function resolveExistingModule(basePath: string): string | null {
  if (isFile(basePath)) return resolve(basePath)

  for (const extension of RESOLVE_EXTENSIONS) {
    const candidate = `${basePath}${extension}`
    if (isFile(candidate)) return resolve(candidate)
  }

  if (isDirectory(basePath)) {
    for (const extension of RESOLVE_EXTENSIONS) {
      const candidate = resolve(basePath, `index${extension}`)
      if (isFile(candidate)) return resolve(candidate)
    }
  }

  return null
}

function rewriteCssFile(
  rootDir: string,
  sourcePath: string,
  sourceTargetPath: string,
  includeInRegistry: boolean,
  ensureSupportFile: (
    sourcePath: string,
    includeInRegistry: boolean,
  ) => InternalSupportFile,
  excludeRegistryFile: (
    sourcePath: string,
  ) => { projectPath: string; ownerUrl: string } | undefined,
): string {
  const sourceCode = readFileSync(sourcePath, "utf-8")
  const imports: string[] = []

  const withoutImports = sourceCode.replace(
    /@import\s+(url\(\s*)?(['"])([^'"]+)\2(\s*\))?/g,
    (
      match,
      urlPrefix: string | undefined,
      quote: string,
      ref: string,
      close: string | undefined,
    ) => {
      const rewritten = rewriteCssReference(
        rootDir,
        sourcePath,
        sourceTargetPath,
        ref,
        includeInRegistry,
        ensureSupportFile,
        excludeRegistryFile,
      )
      const value =
        rewritten === ref
          ? match
          : `@import ${urlPrefix ?? ""}${quote}${rewritten}${quote}${close ?? ""}`
      imports.push(value)
      return `__21ST_CSS_IMPORT_${imports.length - 1}__`
    },
  )

  return withoutImports
    .replace(
      /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
      (match, quote: string, ref: string) => {
        const rewritten = rewriteCssReference(
          rootDir,
          sourcePath,
          sourceTargetPath,
          ref,
          includeInRegistry,
          ensureSupportFile,
          excludeRegistryFile,
        )
        if (rewritten === ref) return match
        return `url(${quote}${rewritten}${quote})`
      },
    )
    .replace(/__21ST_CSS_IMPORT_(\d+)__/g, (match, index: string) => {
      return imports[Number(index)] ?? match
    })
}

function rewriteCssReference(
  rootDir: string,
  sourcePath: string,
  sourceTargetPath: string,
  ref: string,
  includeInRegistry: boolean,
  ensureSupportFile: (
    sourcePath: string,
    includeInRegistry: boolean,
  ) => InternalSupportFile,
  excludeRegistryFile: (
    sourcePath: string,
  ) => { projectPath: string; ownerUrl: string } | undefined,
): string {
  if (isExternalCssReference(ref)) return ref

  const { path: refPath, suffix } = splitSpecifierSuffix(ref)
  if (!refPath.startsWith(".") && !refPath.startsWith("/")) return ref

  const basePath = refPath.startsWith(".")
    ? resolve(dirname(sourcePath), refPath)
    : resolve(rootDir, refPath.slice(1))
  const resolvedPath = resolveExistingModule(basePath)
  if (!resolvedPath) {
    throw new Error(`Unable to resolve CSS reference "${ref}" from "${sourcePath}"`)
  }

  const registryFile = excludeRegistryFile(resolvedPath)
  if (registryFile) {
    return toRelativeImport(sourceTargetPath, registryFile.projectPath, false, suffix)
  }

  const supportFile = ensureSupportFile(resolvedPath, includeInRegistry)
  return toRelativeImport(sourceTargetPath, supportFile.targetPath, false, suffix)
}

function toRelativeImport(
  fromTargetPath: string,
  toTargetPath: string,
  stripExtension: boolean,
  suffix = "",
): string {
  let importPath = relative(dirname(fromTargetPath), toTargetPath)
    .split(sep)
    .join("/")
  if (!importPath.startsWith(".")) {
    importPath = `./${importPath}`
  }
  if (stripExtension) {
    importPath = importPath.replace(/\.(tsx|ts|jsx|js)$/i, "")
  }
  return `${importPath}${suffix}`
}

function splitSpecifierSuffix(specifier: string): { path: string; suffix: string } {
  const queryIndex = specifier.search(/[?#]/)
  if (queryIndex === -1) {
    return { path: specifier, suffix: "" }
  }
  return {
    path: specifier.slice(0, queryIndex),
    suffix: specifier.slice(queryIndex),
  }
}

function isExternalSpecifier(specifier: string): boolean {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/")
  ) {
    return false
  }
  return true
}

function getPackageName(specifier: string): string {
  const { path } = splitSpecifierSuffix(specifier)
  const parts = path.split("/")
  if (path.startsWith("@") && parts.length >= 2) {
    const [scope, name] = parts
    return `${scope}/${name}`
  }
  return parts[0] ?? path
}

function isExternalCssReference(ref: string): boolean {
  return (
    ref.startsWith("http://") ||
    ref.startsWith("https://") ||
    ref.startsWith("//") ||
    ref.startsWith("data:") ||
    ref.startsWith("#")
  )
}

function assertInsideRoot(rootDir: string, resolvedPath: string): void {
  const rel = relative(rootDir, resolvedPath)
  if (rel && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new Error(
      `Cannot publish local dependency outside project root: ${resolvedPath}`,
    )
  }
}

function assertNotProjectConfigFile(rootDir: string, resolvedPath: string): void {
  const projectPath = toProjectRelativePath(rootDir, resolvedPath)
  if (!PROJECT_CONFIG_FILES.has(projectPath)) return

  throw new Error(
    `Cannot publish "${projectPath}" as a support file. Project config files may contain private registry credentials.`,
  )
}

function isFile(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile()
}

function isDirectory(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isDirectory()
}

function textToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function normalizeRegistryOwnedFiles(
  registryOwnedFiles: Map<string, string> | undefined,
): Map<string, string> {
  if (!registryOwnedFiles) return new Map()
  return new Map(
    [...registryOwnedFiles.entries()].map(([path, ownerUrl]) => [
      normalizeProjectRelativePath(path),
      ownerUrl,
    ]),
  )
}

function getRegistryOwnerUrl(
  rootDir: string,
  sourcePath: string,
  registryOwnedFiles: Map<string, string>,
): string | undefined {
  return registryOwnedFiles.get(toProjectRelativePath(rootDir, sourcePath))
}

function toProjectRelativePath(rootDir: string, sourcePath: string): string {
  return normalizeProjectRelativePath(relative(rootDir, resolve(sourcePath)))
}

function normalizeProjectRelativePath(path: string): string {
  return path
    .split(sep)
    .join("/")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
}
