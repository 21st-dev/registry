import * as p from "@clack/prompts"
import type { CliAnalyticsMetadata } from "./analytics.js"
import { getApiBaseUrl } from "./config.js"
import { exitWithError } from "./exit.js"
import { getFlagValue, hasFlag, requireApiKey } from "./utils.js"

interface SearchResult {
  name: string
  slug: string
  description: string | null
  registry: string
  visibility: string
  install_ref: string
  url: string
  preview_url: string | null
  bundle_html_url: string | null
  tags: string[]
  author: string | null
  updated_at: string
  score: number
}

interface SearchResponse {
  query: string
  scope: string
  results: SearchResult[]
}

const API_BASE = getApiBaseUrl().replace(/\/$/, "")

export async function search(args: string[]): Promise<CliAnalyticsMetadata | void> {
  const positional = args.find((a) => !a.startsWith("--"))
  if (!positional) {
    const message =
      `Usage: npx @21st-dev/registry search "<query>" [--scope team|mine|public] [--limit N] [--json]`
    console.error(message)
    exitWithError(message)
  }

  const apiKey = requireApiKey()
  const scope = getFlagValue(args, "--scope") ?? "team"
  const limit = getFlagValue(args, "--limit") ?? "25"
  const wantJson = hasFlag(args, "--json")

  const url =
    `${API_BASE}/components/search?` +
    new URLSearchParams({
      q: positional,
      scope,
      limit,
    }).toString()

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
      /* */
    }
    const message = `search failed (${res.status}): ${msg || res.statusText}`
    console.error(message)
    exitWithError(message)
  }

  const data = (await res.json()) as SearchResponse
  const metadata = {
    limit: Number(limit),
    query_length: positional.length,
    result_count: data.results.length,
    scope,
  }

  if (wantJson) {
    console.log(JSON.stringify(data, null, 2))
    return metadata
  }

  if (data.results.length === 0) {
    p.log.info(`No components matching "${data.query}" in ${data.scope} scope.`)
    return metadata
  }

  console.log("")
  console.log(`Found ${data.results.length} component(s) for "${data.query}":`)
  console.log("")

  for (const r of data.results) {
    const tags = r.tags.length ? `  [${r.tags.join(", ")}]` : ""
    console.log(`  ${r.install_ref}${tags}`)
    if (r.description) {
      console.log(`    ${r.description}`)
    }
    console.log(`    ${r.url}`)
    console.log(``)
  }

  console.log(`Install:  npx @21st-dev/registry add <ref>`)
  return metadata
}
