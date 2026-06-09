import * as p from "@clack/prompts"
import type { CliAnalyticsMetadata } from "./analytics.js"
import { getApiBaseUrl, getApiKey, saveApiKey } from "./config.js"
import { exitWithError } from "./exit.js"

const API_BASE = getApiBaseUrl().replace(/\/$/, "")
const API_KEY_URL = "https://21st.dev/team/api-keys"

async function verifyKey(apiKey: string): Promise<{ user: any; team: any }> {
  const res = await fetch(`${API_BASE}/registry/me`, {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
  })
  if (!res.ok) throw new Error("Invalid API key")
  return res.json()
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

export async function login(
  opts?: { apiKey?: string },
): Promise<CliAnalyticsMetadata | void> {
  const key = opts?.apiKey

  if (key) {
    try {
      const { user, team } = await verifyKey(key)
      saveApiKey(key.trim())
      console.log(
        `Authenticated as ${user.displayName || user.email} (team: ${team.name})`,
      )
      console.log("Key saved to ~/.an/credentials")
      return { mode: "flag" }
    } catch {
      const message = `Error: Invalid API key. Get a new one at ${API_KEY_URL}`
      console.error(message)
      exitWithError(message)
    }
    return
  }

  if (!isInteractive()) {
    const message =
      "Error: No API key provided. Use --api-key KEY or set API_KEY_21ST."
    console.error(message)
    console.error(`Get your API key at ${API_KEY_URL}`)
    exitWithError(message)
  }

  p.intro("@21st-dev/registry login")
  if (getApiKey()) p.log.info("Already logged in. Continuing will re-authenticate.")
  p.log.info(`Get your API key at ${API_KEY_URL}`)

  const apiKey = await p.text({
    message: "Enter your API key",
    validate: (val) => {
      if (!val.trim()) return "API key cannot be empty"
    },
  })
  if (p.isCancel(apiKey)) {
    p.cancel("Login cancelled.")
    process.exit(0)
  }

  const s = p.spinner()
  s.start("Verifying API key...")
  try {
    const { user, team } = await verifyKey(apiKey)
    saveApiKey(apiKey.trim())
    s.stop("Verified")
    p.log.success(
      `Authenticated as ${user.displayName || user.email} (team: ${team.name})`,
    )
    p.log.info("Key saved to ~/.an/credentials")
    p.outro("Done")
    return { mode: "interactive" }
  } catch {
    s.stop("Invalid API key")
    const message = `Invalid API key. Get a new one at ${API_KEY_URL}`
    p.log.error(message)
    exitWithError(message)
  }
}
