import * as p from "@clack/prompts"
import type { CliAnalyticsMetadata } from "./analytics.js"
import { getApiBaseUrl } from "./config.js"
import { exitWithError } from "./exit.js"
import { trpcMutation, trpcQuery } from "./trpc.js"
import {
  formatTable,
  getFlagValue,
  hasFlag,
  isInteractive,
  printAndExit,
  requireApiKey,
} from "./utils.js"

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

// === team management (CRU via tRPC) ===

// Team slug is treated as always present (the null-slug gap for teams
// created after 2026-04-30 is being fixed in a separate task).
export interface TeamSummary {
  id: string
  name: string
  slug: string
  description: string | null
  user_id: string
  created_at: string
  isOwner: boolean
  _count: { members: number; magicProjects: number }
}

interface TeamMembersResponse {
  owner: { id: string; email: string; display_name: string | null }
  members: Array<{
    id: string
    email: string
    created_at: string
    user: { id: string; email: string; display_name: string | null }
  }>
  isOwner: boolean
  inviteToken?: string
}

interface PendingInvite {
  id: string
  email: string
  status: string
  last_sent_at: string | null
}

/**
 * Raw team rows from tRPC carry integration blobs (GitHub access tokens,
 * sandbox env vars, …). Whitelist what the CLI prints so team secrets
 * don't end up in terminals, CI logs, or agent transcripts.
 */
const TEAM_OUTPUT_FIELDS = [
  "id",
  "name",
  "slug",
  "description",
  "user_id",
  "created_at",
  "updated_at",
  "isOwner",
  "_count",
] as const

function pickTeamFields(team: object): Record<string, unknown> {
  const source = team as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of TEAM_OUTPUT_FIELDS) {
    if (key in source) out[key] = source[key]
  }
  return out
}

/** Default team = the team the API key is bound to (via REST /registry/me). */
export async function getDefaultTeam(): Promise<{
  id: string
  name: string
  slug: string
}> {
  const apiKey = requireApiKey()
  const res = await fetch(`${API_BASE}/registry/me`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    printAndExit(
      `Failed to resolve your team (HTTP ${res.status}). Run \`npx @21st-dev/registry login\` first.`,
    )
  }
  const data = (await res.json()) as {
    team: { id: string; name: string; slug: string }
  }
  return data.team
}

/**
 * Resolve a `--team <slug>` value to a team. Without a value, returns the
 * team the API key is bound to.
 */
export async function resolveTeam(
  teamSlug: string | undefined,
): Promise<{ id: string; name: string; slug: string }> {
  if (!teamSlug) return getDefaultTeam()

  const teams = await trpcQuery<TeamSummary[]>("teams.getUserTeams")
  const found = teams.find((t) => t.slug === teamSlug)
  if (found) return found

  printAndExit(
    `Team "${teamSlug}" not found. Your teams:\n` +
      (teams
        .map((t) => `  ${t.slug}  ·  ${t.name}${t.isOwner ? "  (owner)" : ""}`)
        .join("\n") || "  (none)"),
  )
}

/** Positional [team] arg or --team flag (positional wins). */
function teamArg(args: string[]): string | undefined {
  const positional = args[0] && !args[0].startsWith("--") ? args[0] : undefined
  return positional ?? getFlagValue(args, "--team")
}

/** `21st-registry team list` */
export async function teamList(
  args: string[],
): Promise<CliAnalyticsMetadata | void> {
  const wantJson = hasFlag(args, "--json")
  const [teams, defaultTeam] = await Promise.all([
    trpcQuery<TeamSummary[]>("teams.getUserTeams"),
    getDefaultTeam(),
  ])

  if (wantJson) {
    console.log(JSON.stringify(teams.map(pickTeamFields), null, 2))
    return { json: true, count: teams.length }
  }

  p.intro("@21st-dev/registry team list")
  if (teams.length === 0) {
    console.log("  (no teams)")
  } else {
    const rows = teams.map((t) => [
      t.name,
      String(t.slug ?? "-"),
      String(t._count.members),
      [t.isOwner ? "owner" : "member", t.id === defaultTeam.id ? "default" : null]
        .filter(Boolean)
        .join(", "),
    ])
    for (const line of formatTable(rows, ["NAME", "SLUG", "MEMBERS", "ROLE"])) {
      console.log(line)
    }
  }
  p.outro(`${teams.length} team(s)`)
  return { json: false, count: teams.length }
}

/** `21st-registry team info [team]` */
export async function teamInfo(
  args: string[],
): Promise<CliAnalyticsMetadata | void> {
  const wantJson = hasFlag(args, "--json")
  const team = await resolveTeam(teamArg(args))
  const [members, pending] = await Promise.all([
    trpcQuery<TeamMembersResponse>("teams.getTeamMembers", { teamId: team.id }),
    trpcQuery<PendingInvite[]>("teams.getPendingInvites", { teamId: team.id }),
  ])

  if (wantJson) {
    console.log(
      JSON.stringify({ team: pickTeamFields(team), members, pending }, null, 2),
    )
    return { json: true, team_id: team.id }
  }

  p.intro("@21st-dev/registry team info")
  console.log(`  Team: ${team.name}  ·  slug: ${team.slug}  ·  id: ${team.id}`)
  console.log("")
  const rows = [
    ["owner", members.owner.display_name ?? "", members.owner.email],
    ...members.members.map((m) => [
      "member",
      m.user.display_name ?? "",
      m.email,
    ]),
    ...pending.map((inv) => ["pending", "", inv.email]),
  ]
  for (const line of formatTable(rows, ["ROLE", "NAME", "EMAIL"])) {
    console.log(line)
  }
  p.outro(`${members.members.length + 1} member(s), ${pending.length} pending`)
  return { json: false, team_id: team.id }
}

/** `21st-registry team create [name] [--description TEXT]` */
export async function teamCreate(
  args: string[],
): Promise<CliAnalyticsMetadata | void> {
  const wantJson = hasFlag(args, "--json")
  let name = args[0] && !args[0].startsWith("--") ? args[0] : undefined
  const description = getFlagValue(args, "--description")

  if (!name) {
    if (!isInteractive()) {
      printAndExit(
        "Usage: 21st-registry team create <name> [--description TEXT]",
      )
    }
    p.intro("@21st-dev/registry team create")
    const input = await p.text({
      message: "Team name",
      validate: (val) => {
        if (!val?.trim()) return "Name cannot be empty"
        if (val.length > 100) return "Name must be 100 characters or less"
      },
    })
    if (p.isCancel(input)) {
      p.cancel("Cancelled.")
      process.exit(0)
    }
    name = input.trim()
  }

  const team = await trpcMutation<{ id: string; name: string; slug: string }>(
    "teams.createTeam",
    { name, ...(description ? { description } : {}) },
  )

  if (wantJson) {
    console.log(JSON.stringify(pickTeamFields(team), null, 2))
  } else {
    p.log.success(`Created team "${team.name}"`)
    p.log.info(`Use it with: --team ${team.slug}`)
  }
  return { json: wantJson, team_id: team.id }
}

/** `21st-registry team edit [team] [--name TEXT] [--description TEXT]` */
export async function teamEdit(
  args: string[],
): Promise<CliAnalyticsMetadata | void> {
  const wantJson = hasFlag(args, "--json")
  const team = await resolveTeam(teamArg(args))
  let name = getFlagValue(args, "--name")
  let description = getFlagValue(args, "--description")

  if (name === undefined && description === undefined) {
    if (!isInteractive()) {
      printAndExit(
        "Nothing to update. Pass --name and/or --description.\nUsage: 21st-registry team edit [team] --name TEXT --description TEXT",
      )
    }
    p.intro("@21st-dev/registry team edit")
    const newName = await p.text({
      message: `Team name (current: ${team.name})`,
      defaultValue: team.name,
    })
    if (p.isCancel(newName)) {
      p.cancel("Cancelled.")
      process.exit(0)
    }
    name = newName.trim() || undefined
  }

  const updated = await trpcMutation<{ id: string; name: string }>(
    "teams.updateTeam",
    {
      teamId: team.id,
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
    },
  )

  if (wantJson) {
    console.log(JSON.stringify(pickTeamFields(updated), null, 2))
  } else {
    p.log.success(`Updated team "${updated.name}"`)
  }
  return { json: wantJson, team_id: team.id }
}

/** `21st-registry team invite <email> [--team TEAM]` */
export async function teamInvite(
  args: string[],
): Promise<CliAnalyticsMetadata | void> {
  const wantJson = hasFlag(args, "--json")
  const email = args[0] && !args[0].startsWith("--") ? args[0] : undefined
  if (!email || !email.includes("@")) {
    printAndExit("Usage: 21st-registry team invite <email> [--team TEAM]")
  }
  const team = await resolveTeam(getFlagValue(args, "--team"))

  await trpcMutation<{ success: boolean }>("teams.sendInviteEmail", {
    teamId: team.id,
    email,
  })

  if (wantJson) {
    console.log(
      JSON.stringify({ success: true, email, team_id: team.id }, null, 2),
    )
  } else {
    p.log.success(`Invite sent to ${email} (team: ${team.name})`)
  }
  return { json: wantJson, team_id: team.id }
}
