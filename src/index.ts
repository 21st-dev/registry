import { createRequire } from "node:module"
import { add } from "./add.js"
import { getApiKey } from "./config.js"
import { installSkill, printSkill } from "./install-skill.js"
import { login } from "./login.js"
import { publish } from "./publish.js"
import { search } from "./search.js"
import {
  inviteLink,
  teamCreate,
  teamEdit,
  teamInfo,
  teamInvite,
  teamList,
} from "./team.js"
import {
  registryCreate,
  registryEdit,
  registryInfo,
  registryList,
} from "./registry-mgmt.js"
import { runTrackedCommand } from "./tracking.js"
import { getFlagValue } from "./utils.js"

const require = createRequire(import.meta.url)
const { version } = require("../package.json") as { version: string }

const command = process.argv[2]
const args = process.argv.slice(3)
const hasFlag = (flag: string) => args.includes(flag)
const trackingOptions = { getApiKey, version }

function showHelp(): void {
  console.log(`@21st-dev/registry v${version} — share & install React components across your team\n`)
  console.log("Usage: npx @21st-dev/registry <command> [options]")
  console.log("   or: 21st-registry <command> [options]\n")
  console.log("Commands:")
  console.log("  login                              Authenticate with 21st.dev")
  console.log("  publish <path-or-flags>            Publish a component (default: cwd)")
  console.log("  add @user/slug                     Install a component from your team library")
  console.log("  search \"<query>\"                   Search your team library")
  console.log("  invite                             Print a shareable invite link for your team")
  console.log("  team <list|info|create|edit|invite>  Manage your teams")
  console.log("  registry <list|info|create|edit>   Manage team registries")
  console.log("  install-skill                      Install the AI-agent skill (Claude Code + Cursor)")
  console.log("  print-skill                        Print the bundled SKILL.md to stdout")
  console.log("\nQuick examples:")
  console.log("  21st-registry ./Button.tsx --description \"Animated button with hover\"")
  console.log("  21st-registry add @serjobas/animated-button")
  console.log("  21st-registry search \"input form\"")
  console.log("\nPublish flags:")
  console.log("  --name TEXT          Display name (auto-detected from default export)")
  console.log("  --description TEXT   1-2 sentence summary (required, 10+ chars)")
  console.log("  --registry NAME      Component type: ui | hooks | blocks | icons (default: ui)")
  console.log("  --runtime NAME       Runtime: react | expo (default: react)")
  console.log("  --to SLUG            Target a registry in the authenticated team")
  console.log("  --registry-dep REF   Shadcn registry dependency URL or @namespace/name (repeatable)")
  console.log("  --tags T1,T2         1-5 tags (default: detected from imports)")
  console.log("  --slug SLUG          URL slug (default: derived from name)")
  console.log("  --component PATH     Component .tsx (positional path also works)")
  console.log("  --demo PATH          Demo .tsx (auto-detected, synthesised if absent)")
  console.log("  --preview PATH       Preview image (optional)")
  console.log("  --visibility V       unlisted (default) | public | private")
  console.log("  --public / --unlisted / --private  Shortcut for --visibility")
  console.log("\nEnvironment:")
  console.log("  API_KEY_21ST         API key (skips login prompt)")
  console.log("  API_URL_21ST         API base URL override")
  console.log("\nDocs: https://21st.dev/docs/publish-cli")
}

if (command === "login") {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log("Usage: npx @21st-dev/registry login [--api-key KEY]")
    console.log("Get your API key at https://21st.dev/team/api-keys")
  } else {
    const apiKey = getFlagValue(args, "--api-key")
    await runTrackedCommand("login", () =>
      login({ apiKey }),
      {
        ...trackingOptions,
        ...(apiKey !== undefined ? { apiKey } : {}),
      },
    )
  }
} else if (command === "add") {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log("Usage: npx @21st-dev/registry add @user/slug [--force] [--no-install] [--dir PATH]")
  } else {
    await runTrackedCommand("add", () => add(args), trackingOptions)
  }
} else if (command === "search") {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(
      `Usage: npx @21st-dev/registry search "<query>" [--scope team|mine|public] [--limit N] [--json]`,
    )
  } else {
    await runTrackedCommand("search", () => search(args), trackingOptions)
  }
} else if (command === "invite" || command === "invite-link") {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log("Usage: npx @21st-dev/registry invite [--refresh] [--quiet] [--json]")
    console.log("")
    console.log("Prints a shareable invite link for your team. Anyone with the link")
    console.log("who signs in becomes a member and can install/publish team components.")
    console.log("")
    console.log("Flags:")
    console.log("  --refresh    Rotate the token, revoking the previous link (owner only)")
    console.log("  --quiet, -q  Print only the URL (handy with `| pbcopy`)")
    console.log("  --json       Machine-readable output")
  } else {
    await runTrackedCommand("invite", () => inviteLink(args), trackingOptions)
  }
} else if (command === "team") {
  const sub = args[0]
  const subArgs = args.slice(1)
  if (hasFlag("--help") || hasFlag("-h") || !sub) {
    console.log("Usage: npx @21st-dev/registry team <subcommand>")
    console.log("")
    console.log("Subcommands:")
    console.log("  list                               Your teams (slug, role, default)")
    console.log("  info [team]                        Team details, members, pending invites")
    console.log("  create [name] [--description TEXT] Create a team (you become owner)")
    console.log("  edit [team] [--name] [--description]  Edit team (owner only)")
    console.log("  invite <email> [--team TEAM]       Send an email invite")
    console.log("")
    console.log("TEAM is the team slug. Default: the team your API key belongs to.")
    console.log("All subcommands accept --json for machine-readable output.")
  } else if (sub === "list") {
    await runTrackedCommand("team-list", () => teamList(subArgs), trackingOptions)
  } else if (sub === "info") {
    await runTrackedCommand("team-info", () => teamInfo(subArgs), trackingOptions)
  } else if (sub === "create") {
    await runTrackedCommand("team-create", () => teamCreate(subArgs), trackingOptions)
  } else if (sub === "edit") {
    await runTrackedCommand("team-edit", () => teamEdit(subArgs), trackingOptions)
  } else if (sub === "invite") {
    await runTrackedCommand("team-invite", () => teamInvite(subArgs), trackingOptions)
  } else {
    console.log(`Unknown team subcommand: ${sub}. Try: list, info, create, edit, invite`)
    process.exit(1)
  }
} else if (command === "registry") {
  const sub = args[0]
  const subArgs = args.slice(1)
  if (hasFlag("--help") || hasFlag("-h") || !sub) {
    console.log("Usage: npx @21st-dev/registry registry <subcommand>")
    console.log("")
    console.log("Subcommands:")
    console.log("  list [--team TEAM]                 Registries in a team")
    console.log("  info <slug> [--team TEAM]          Registry details")
    console.log("  create [name] [--slug] [--description] [--team]  Create a registry")
    console.log("  edit <slug> [--name] [--description] [--team]    Edit a registry")
    console.log("")
    console.log("Registries are addressed by slug within a team (default: your API key's team).")
    console.log("All subcommands accept --json for machine-readable output.")
  } else if (sub === "list") {
    await runTrackedCommand("registry-list", () => registryList(subArgs), trackingOptions)
  } else if (sub === "info") {
    await runTrackedCommand("registry-info", () => registryInfo(subArgs), trackingOptions)
  } else if (sub === "create") {
    await runTrackedCommand("registry-create", () => registryCreate(subArgs), trackingOptions)
  } else if (sub === "edit") {
    await runTrackedCommand("registry-edit", () => registryEdit(subArgs), trackingOptions)
  } else {
    console.log(`Unknown registry subcommand: ${sub}. Try: list, info, create, edit`)
    process.exit(1)
  }
} else if (command === "install-skill") {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log("Usage: npx @21st-dev/registry install-skill [--global] [--claude] [--cursor] [--force]")
    console.log("")
    console.log("Installs the `21st-registry` skill so AI agents (Claude Code, Cursor, etc.)")
    console.log("automatically know how to publish, search, and install components.")
    console.log("")
    console.log("Default: writes to .claude/skills/ and .cursor/skills/ in the current project.")
    console.log("With --global: writes to ~/.claude/skills/ and ~/.cursor/skills/.")
  } else {
    await runTrackedCommand("install-skill", () => installSkill(args), trackingOptions)
  }
} else if (command === "print-skill") {
  printSkill()
} else if (command === "publish") {
  if (hasFlag("--help") || hasFlag("-h")) {
    showHelp()
  } else {
    await runTrackedCommand("publish", () => publish(args), trackingOptions)
  }
} else if (command === "--version" || command === "-v") {
  console.log(version)
} else if (command === "--help" || command === "-h" || command === undefined) {
  showHelp()
} else if (!command.startsWith("--")) {
  // Bare positional like `21st-registry ./Button.tsx` → publish
  await runTrackedCommand("publish", () => publish(process.argv.slice(2)), trackingOptions)
} else {
  console.log(`Unknown command: ${command}`)
  showHelp()
  process.exit(1)
}
