import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { CliAnalyticsMetadata } from "./analytics.js"
import { exitWithError } from "./exit.js"
import { getFlagValue, hasFlag } from "./utils.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Default URL where the 21st-registry SKILL.md lives in the wild. */
const DEFAULT_SKILL_URL = "https://21st.dev/api/skills/21st-registry"

/**
 * `21st-registry install-skill`
 *
 * Copies the bundled `21st-registry` skill into the user's project (default)
 * or globally to their home directory (with --global). Works for both Claude
 * Code (`.claude/skills/`) and Cursor (`.cursor/skills/`) — both use the
 * same Anthropic SKILL.md format.
 *
 * Flags:
 *   --global       Install to ~/.claude/skills/ + ~/.cursor/skills/
 *   --claude       Only install to .claude/skills (skip Cursor)
 *   --cursor       Only install to .cursor/skills (skip Claude)
 *   --force        Overwrite existing files
 *   --from-url URL Fetch SKILL.md from a URL instead of the bundled copy
 *                  (defaults to https://21st.dev/api/skills/21st-registry if
 *                  the bundled file isn't found)
 *
 * Default behaviour: project-level, both Claude and Cursor.
 */
export async function installSkill(
  args: string[],
): Promise<CliAnalyticsMetadata | void> {
  const isGlobal = hasFlag(args, "--global") || hasFlag(args, "-g")
  const claudeOnly = hasFlag(args, "--claude")
  const cursorOnly = hasFlag(args, "--cursor")
  const force = hasFlag(args, "--force") || hasFlag(args, "-f")
  const explicitUrl = getFlagValue(args, "--from-url")

  let content: string | null = null
  let sourceLabel = "(bundled)"

  if (explicitUrl) {
    content = await fetchUrlSkill(explicitUrl)
    sourceLabel = explicitUrl
  } else {
    // Locate the bundled SKILL.md. When installed via npm:
    //   /node_modules/@21st-dev/registry/dist/index.js
    //   /node_modules/@21st-dev/registry/skills/21st-registry/SKILL.md
    // When run from source: packages/an-sdk/publish/dist/index.js
    const candidates = [
      resolve(__dirname, "../skills/21st-registry/SKILL.md"),
      resolve(__dirname, "../../skills/21st-registry/SKILL.md"),
      resolve(__dirname, "../../../packages/an-sdk/publish/skills/21st-registry/SKILL.md"),
    ]
    const sourcePath = candidates.find((p) => existsSync(p))
    if (sourcePath) {
      content = readFileSync(sourcePath, "utf-8")
      sourceLabel = sourcePath
    } else {
      // Fallback: fetch from the public URL.
      console.log(`Bundled SKILL.md not found, fetching from ${DEFAULT_SKILL_URL}…`)
      content = await fetchUrlSkill(DEFAULT_SKILL_URL)
      sourceLabel = DEFAULT_SKILL_URL
    }
  }

  if (!content) {
    const message = `Failed to load SKILL.md content. Source: ${sourceLabel}`
    console.error(message)
    exitWithError(message)
  }

  const targets: { name: string; dir: string }[] = []
  const baseDir = isGlobal ? homedir() : process.cwd()
  if (!cursorOnly) {
    targets.push({
      name: "Claude Code",
      dir: join(baseDir, ".claude/skills/21st-registry"),
    })
  }
  if (!claudeOnly) {
    targets.push({
      name: "Cursor",
      dir: join(baseDir, ".cursor/skills/21st-registry"),
    })
  }

  for (const target of targets) {
    const dest = join(target.dir, "SKILL.md")
    if (existsSync(dest) && !force) {
      console.log(`✗ ${target.name}: ${dest} already exists. Use --force to overwrite.`)
      continue
    }
    mkdirSync(target.dir, { recursive: true })
    writeFileSync(dest, content, "utf-8")
    console.log(`✓ ${target.name}: ${dest}`)
  }
  if (sourceLabel.startsWith("http")) {
    console.log(`  (source: ${sourceLabel})`)
  }

  console.log("")
  console.log(
    isGlobal
      ? "Skill installed globally. Any AI agent (Claude Code, Cursor, or any other tool that reads SKILL.md) running on this machine can now use `21st-registry` automatically."
      : "Skill installed in this project. Commit `.claude/skills/` and `.cursor/skills/` so teammates get it too.",
  )
  return {
    claude: !cursorOnly,
    cursor: !claudeOnly,
    force,
    from_url: Boolean(explicitUrl),
    global: isGlobal,
  }
}

async function fetchUrlSkill(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/markdown, text/plain, */*" },
    })
    if (!res.ok) {
      console.error(`HTTP ${res.status} fetching ${url}`)
      return null
    }
    const text = await res.text()
    // Sanity check: skills.sh-compatible SKILL.md starts with `---` frontmatter.
    if (!text.trimStart().startsWith("---")) {
      console.warn(
        `Warning: response body doesn't look like a SKILL.md (no YAML frontmatter).`,
      )
    }
    return text
  } catch (err) {
    console.error(`Failed to fetch ${url}:`, err instanceof Error ? err.message : err)
    return null
  }
}

// Quick-print the bundled SKILL.md content (for piping / debugging)
export function printSkill(): void {
  const candidates = [
    resolve(__dirname, "../skills/21st-registry/SKILL.md"),
    resolve(__dirname, "../../skills/21st-registry/SKILL.md"),
    resolve(__dirname, "../../../packages/an-sdk/publish/skills/21st-registry/SKILL.md"),
  ]
  const sourcePath = candidates.find((p) => existsSync(p))
  if (!sourcePath) {
    console.error("Bundled SKILL.md not found")
    process.exit(1)
  }
  process.stdout.write(readFileSync(sourcePath, "utf-8"))
}
