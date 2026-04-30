import * as p from "@clack/prompts"
import { getApiKey } from "./config.js"

export function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1 || idx + 1 >= args.length) return undefined
  const next = args[idx + 1]?.trim()
  if (!next || next.startsWith("--")) return undefined
  return next
}

export function getRepeatedFlagValues(args: string[], flag: string): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      const next = args[i + 1]?.trim()
      if (next && !next.startsWith("--")) {
        out.push(next)
        i++
      }
    }
  }
  return out
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

export function validateSlug(slug: string): string | undefined {
  if (!slug) return "Slug cannot be empty"
  if (!SLUG_RE.test(slug)) {
    return "Slug must be lowercase alphanumeric with hyphens (no leading/trailing hyphens)"
  }
  if (slug.length > 100) return "Slug must be 100 characters or less"
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
}

export function requireApiKey(): string {
  const apiKey = getApiKey()
  if (!apiKey) {
    p.log.error(
      "Not logged in. Run `npx @21st-dev/registry login` first, or set API_KEY_21ST.",
    )
    process.exit(1)
  }
  return apiKey
}
