import { createRequire } from "node:module"
import { add } from "./add.js"
import { installSkill, printSkill } from "./install-skill.js"
import { login } from "./login.js"
import { publish } from "./publish.js"
import { search } from "./search.js"
import { inviteLink } from "./team.js"
import { getFlagValue } from "./utils.js"

const require = createRequire(import.meta.url)
const { version } = require("../package.json") as { version: string }

const command = process.argv[2]
const args = process.argv.slice(3)
const hasFlag = (flag: string) => args.includes(flag)

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
    await login({ apiKey: getFlagValue(args, "--api-key") })
  }
} else if (command === "add") {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log("Usage: npx @21st-dev/registry add @user/slug [--force] [--no-install] [--dir PATH]")
  } else {
    await add(args)
  }
} else if (command === "search") {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(
      `Usage: npx @21st-dev/registry search "<query>" [--scope team|mine|public] [--limit N] [--json]`,
    )
  } else {
    await search(args)
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
    await inviteLink(args)
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
    await installSkill(args)
  }
} else if (command === "print-skill") {
  printSkill()
} else if (command === "publish") {
  if (hasFlag("--help") || hasFlag("-h")) {
    showHelp()
  } else {
    await publish(args)
  }
} else if (command === "--version" || command === "-v") {
  console.log(version)
} else if (command === "--help" || command === "-h" || command === undefined) {
  showHelp()
} else if (!command.startsWith("--")) {
  // Bare positional like `21st-registry ./Button.tsx` → publish
  await publish(process.argv.slice(2))
} else {
  console.log(`Unknown command: ${command}`)
  showHelp()
  process.exit(1)
}
