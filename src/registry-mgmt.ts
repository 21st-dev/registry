import * as p from "@clack/prompts"
import type { CliAnalyticsMetadata } from "./analytics.js"
import { resolveTeam } from "./team.js"
import { trpcMutation, trpcQuery } from "./trpc.js"
import {
  formatTable,
  getFlagValue,
  hasFlag,
  isInteractive,
  printAndExit,
  slugify,
  validateSlug,
} from "./utils.js"

export interface RegistrySummary {
  id: string
  name: string
  slug: string
  description: string | null
  team_id: string
  created_at: string
  _count: { components: number }
}

interface RegistryDetails extends RegistrySummary {
  team: {
    id: string
    user_id: string
    slug: string | null
    name: string
    _count: { members: number }
  }
}

/**
 * Registry slugs are only unique per team — the CLI addresses registries
 * by (team, slug) and resolves to the UUID the tRPC procedures expect.
 */
async function resolveRegistry(
  teamId: string,
  slug: string,
): Promise<RegistrySummary> {
  const registries = await trpcQuery<RegistrySummary[]>(
    "registries.listByTeam",
    { teamId },
  )
  const found = registries.find((r) => r.slug === slug)
  if (!found) {
    printAndExit(
      `Registry "${slug}" not found in this team. Available: ${
        registries.map((r) => r.slug).join(", ") || "(none)"
      }`,
    )
  }
  return found
}

/** `21st-registry registry list [--team TEAM]` */
export async function registryList(
  args: string[],
): Promise<CliAnalyticsMetadata | void> {
  const wantJson = hasFlag(args, "--json")
  const team = await resolveTeam(getFlagValue(args, "--team"))
  const registries = await trpcQuery<RegistrySummary[]>(
    "registries.listByTeam",
    { teamId: team.id },
  )

  if (wantJson) {
    console.log(JSON.stringify(registries, null, 2))
    return { json: true, count: registries.length, team_id: team.id }
  }

  p.intro("@21st-dev/registry registry list")
  console.log(`  Team: ${team.name}`)
  console.log("")
  if (registries.length === 0) {
    console.log("  (no registries)")
  } else {
    const rows = registries.map((r) => [
      r.slug,
      r.name,
      String(r._count.components),
      r.description ?? "",
    ])
    for (const line of formatTable(rows, ["SLUG", "NAME", "COMPONENTS", "DESCRIPTION"])) {
      console.log(line)
    }
  }
  p.outro(`${registries.length} registr${registries.length === 1 ? "y" : "ies"}`)
  return { json: false, count: registries.length, team_id: team.id }
}

/** `21st-registry registry info <slug> [--team TEAM]` */
export async function registryInfo(
  args: string[],
): Promise<CliAnalyticsMetadata | void> {
  const wantJson = hasFlag(args, "--json")
  const slug = args[0] && !args[0].startsWith("--") ? args[0] : undefined
  if (!slug) {
    printAndExit("Usage: 21st-registry registry info <slug> [--team TEAM]")
  }
  const team = await resolveTeam(getFlagValue(args, "--team"))
  const summary = await resolveRegistry(team.id, slug)
  const registry = await trpcQuery<RegistryDetails>("registries.getById", {
    registryId: summary.id,
  })

  if (wantJson) {
    console.log(JSON.stringify(registry, null, 2))
    return { json: true, registry_id: registry.id }
  }

  p.intro("@21st-dev/registry registry info")
  console.log(`  ${registry.name} (${registry.slug})`)
  if (registry.description) console.log(`  ${registry.description}`)
  console.log("")
  console.log(
    `  Team: ${registry.team.name}  ·  members: ${registry.team._count.members}`,
  )
  console.log(`  Components: ${registry._count.components}`)
  console.log(`  Created: ${registry.created_at}`)
  p.outro("Done")
  return { json: false, registry_id: registry.id }
}

/** `21st-registry registry create [name] [--slug SLUG] [--description TEXT] [--team TEAM]` */
export async function registryCreate(
  args: string[],
): Promise<CliAnalyticsMetadata | void> {
  const wantJson = hasFlag(args, "--json")
  let name = args[0] && !args[0].startsWith("--") ? args[0] : undefined
  const description = getFlagValue(args, "--description")

  if (!name) {
    if (!isInteractive()) {
      printAndExit(
        "Usage: 21st-registry registry create <name> [--slug SLUG] [--description TEXT] [--team TEAM]",
      )
    }
    p.intro("@21st-dev/registry registry create")
    const input = await p.text({
      message: "Registry name",
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

  const slug = getFlagValue(args, "--slug") ?? slugify(name)
  const slugError = validateSlug(slug)
  if (slugError) printAndExit(`Invalid slug "${slug}": ${slugError}`)

  const team = await resolveTeam(getFlagValue(args, "--team"))
  const registry = await trpcMutation<RegistrySummary>("registries.create", {
    teamId: team.id,
    name,
    slug,
    ...(description ? { description } : {}),
  })

  if (wantJson) {
    console.log(JSON.stringify(registry, null, 2))
  } else {
    p.log.success(
      `Created registry "${registry.name}" (${registry.slug}) in team ${team.name}`,
    )
    p.log.info(`Publish to it with: 21st-registry publish --to ${registry.slug}`)
  }
  return { json: wantJson, registry_id: registry.id, team_id: team.id }
}

/** `21st-registry registry edit <slug> [--name TEXT] [--description TEXT] [--team TEAM]` */
export async function registryEdit(
  args: string[],
): Promise<CliAnalyticsMetadata | void> {
  const wantJson = hasFlag(args, "--json")
  const slug = args[0] && !args[0].startsWith("--") ? args[0] : undefined
  if (!slug) {
    printAndExit(
      "Usage: 21st-registry registry edit <slug> [--name TEXT] [--description TEXT] [--team TEAM]",
    )
  }
  const name = getFlagValue(args, "--name")
  const description = getFlagValue(args, "--description")
  if (name === undefined && description === undefined) {
    printAndExit("Nothing to update. Pass --name and/or --description.")
  }

  const team = await resolveTeam(getFlagValue(args, "--team"))
  const summary = await resolveRegistry(team.id, slug)
  const updated = await trpcMutation<RegistrySummary>("registries.update", {
    registryId: summary.id,
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
  })

  if (wantJson) {
    console.log(JSON.stringify(updated, null, 2))
  } else {
    p.log.success(`Updated registry "${updated.name}" (${updated.slug})`)
  }
  return { json: wantJson, registry_id: updated.id }
}
