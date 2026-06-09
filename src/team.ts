import * as p from "@clack/prompts"
import type { CliAnalyticsMetadata } from "./analytics.js"
import { getApiBaseUrl } from "./config.js"
import { exitWithError } from "./exit.js"
import { hasFlag, requireApiKey } from "./utils.js"

interface InviteLinkResponse {
  invite_url: string
  token: string
  team_id: string
  team_name: string | null
  rotated: boolean
  onboarding: {
    cli_setup_url: string
    install_command: string
  }
}

const API_BASE = getApiBaseUrl().replace(/\/$/, "")

/** `21st-registry invite` — print a copy-pasteable invite link. */
export async function inviteLink(
  args: string[],
): Promise<CliAnalyticsMetadata | void> {
  const apiKey = requireApiKey()
  const refresh = hasFlag(args, "--refresh") || hasFlag(args, "--regenerate")
  const wantJson = hasFlag(args, "--json")
  const quiet = hasFlag(args, "--quiet") || hasFlag(args, "-q")

  const url = `${API_BASE}/team/invite-link${refresh ? "?refresh=1" : ""}`
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => "")
    let msg = errBody
    try {
      const parsed = JSON.parse(errBody) as { message?: string; error?: string }
      msg = parsed.message || parsed.error || errBody
    } catch {
      /* keep raw */
    }
    const message = `invite-link failed (${res.status}): ${msg || res.statusText}`
    console.error(message)
    exitWithError(message)
  }

  const data = (await res.json()) as InviteLinkResponse

  if (wantJson) {
    console.log(JSON.stringify(data, null, 2))
    return { json: wantJson, quiet, refresh }
  }

  if (quiet) {
    // Just the URL — handy for `pbcopy`, Slack bots, etc.
    console.log(data.invite_url)
    return { json: wantJson, quiet, refresh }
  }

  p.intro("@21st-dev/registry invite")
  if (data.rotated) {
    p.log.success(
      "Rotated invite link. Old token revoked — anyone using the previous link will get a 'expired' page.",
    )
  } else {
    p.log.info(
      `Team: ${data.team_name ?? "(unnamed)"}  ·  token: ${data.token}`,
    )
  }
  console.log("")
  console.log("📨 Share this link with your teammate:")
  console.log("")
  console.log(`   ${data.invite_url}`)
  console.log("")
  p.log.info(
    "After they sign in and join, they can set up the CLI here:",
  )
  console.log(`   ${data.onboarding.cli_setup_url}`)
  console.log("")
  p.log.info(
    "Or, if you want only the URL (e.g. piping to pbcopy), use --quiet:",
  )
  console.log("   npx @21st-dev/registry invite --quiet | pbcopy")
  p.outro("Done")
  return { json: wantJson, quiet, refresh }
}
