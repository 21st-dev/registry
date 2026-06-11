# @21st-dev/registry

> **Open-source CLI for managing private React component registries.**
> Publish, install, search, and share components across your team — with
> first-class support for AI agents (Claude Code, Cursor) via the bundled
> `21st-registry` skill.

[![npm](https://img.shields.io/npm/v/@21st-dev/registry.svg)](https://www.npmjs.com/package/@21st-dev/registry)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

```bash
npx @21st-dev/registry login
npx @21st-dev/registry ./Button.tsx --description "Animated primary button"
npx @21st-dev/registry add @your-team/button
```

## What it does

A team library is a **shadcn-compatible registry** of your team's React
components, hosted on [21st.dev](https://21st.dev). You can:

- **Publish** — push any `.tsx` file (with auto-detected demo) into a team
  registry. Component visibility controls who can install it.
- **Install** — `npx @21st-dev/registry add @team/component` writes the file
  into your project and runs your package manager (pnpm/npm/yarn/bun).
- **Search** — semantic search across the team library by name, description,
  or tags.
- **Invite** — print a shareable link or send email invites for teammates.
- **Multi-registry** — organise components into named registries (e.g.
  `marketing-blocks`, `internal-tools`).

Every command works equally well from the terminal **or** through any AI
agent that supports Anthropic's
[SKILL.md format](https://github.com/anthropics/skills) — the bundled skill
teaches the agent how and when to use the CLI on your behalf.

## Quick start

```bash
# 1. One-time setup — install the AI-agent skill globally
npx @21st-dev/registry install-skill --global

# 2. Authenticate (uses ~/.an/credentials, also reads API_KEY_21ST env var)
npx @21st-dev/registry login

# 3. Publish a component
npx @21st-dev/registry ./Button.tsx \
  --description "Animated primary button with loading state"

# 4. Install in another project
npx @21st-dev/registry add @your-team/button
```

## Convention

A publishable component lives in a directory like:

```
my-button/
├── 21st.json
├── component.tsx               ← must default-export the component
├── demos/
│   └── default.tsx             ← imports the component, renders it with props
└── preview.png                 ← optional, ~1200×900 PNG/JPEG
```

`21st.json`:

```json
{
  "name": "Animated Button",
  "description": "Smooth hover & press animations using framer-motion.",
  "registry": "ui",
  "tags": ["button", "animation"],
  "visibility": "unlisted",
  "component": "./component.tsx",
  "demos": [
    {
      "name": "Default",
      "slug": "default",
      "file": "./demos/default.tsx",
      "preview": "./preview.png"
    }
  ]
}
```

## Demo imports

The published component lives at `@/components/ui/{slug}` inside the
sandbox. The CLI rewrites any **relative** demo import that resolves to your
`component` file into that alias automatically — so this works:

```tsx
// demos/default.tsx
import Button from "../component"

export default function Demo() {
  return <Button>Click</Button>
}
```

## Non-interactive flags

```bash
npx @21st-dev/registry \
  --name "Animated Button" \
  --description "Smooth hover & press animations." \
  --registry ui \
  --tags "button,animation" \
  --component ./component.tsx \
  --demo ./demos/default.tsx \
  --preview ./preview.png \
  --to my-registry \
  --unlisted
```

### Visibility tiers

- `--unlisted` (default) — direct URL only, not in marketplace search
- `--public` — submitted to the public 21st.dev marketplace (admin review)
- `--private` — only members of the registry team

### Multi-registry targeting

`--to <registry-slug>` targets a specific registry inside the team attached to
your API key. Without it, the server uses your team's first/default registry.

## AI Agent Skill

```bash
# Install for any agent that supports SKILL.md format
npx @21st-dev/registry install-skill --global
```

The skill teaches AI agents (Claude Code, Cursor, etc.) when and how to
publish, install, and search components in your team registry — so you can
just say "publish this to our registry" and the agent handles the rest.

Also installable from skills.sh:

```bash
npx skills add 21st-dev/registry
```

## Auth

Credentials live at `~/.an/credentials`. Run `npx @21st-dev/registry login` once — it
prompts for your API key from
[https://21st.dev/team/api-keys](https://21st.dev/team/api-keys).

You can also pass `API_KEY_21ST=...` in the environment.

## Environment variables

| Var | Default | What |
|---|---|---|
| `API_KEY_21ST` | – | Auth token (also accepts legacy `AN_API_KEY`) |
| `API_URL_21ST` | `https://21st.dev/api/v1` | Override API base |
| `APP_URL_21ST` | `https://21st.dev` | Override app base (used in success URL) |

## Commands

| Command | What it does |
|---|---|
| `login` | Authenticate with 21st.dev |
| `publish <path>` (or just `<path>`) | Publish a component |
| `add @user/slug` | Install from a team registry |
| `search "<query>"` | Semantic search across your team's library |
| `invite` | Print a shareable invite link for your team |
| `team <subcommand>` | View, create, and edit your teams |
| `registry <subcommand>` | View, create, and edit team registries |
| `install-skill` | Install the AI-agent skill (Claude + Cursor) |
| `print-skill` | Print the bundled SKILL.md to stdout |

Run any command with `--help` for full flag list.

## Teams & registries

Manage teams and registries without leaving the terminal. All subcommands
accept `--json` for machine-readable output. Teams are addressed by slug via
`--team <slug>` (or a positional `[team]` argument where shown); without it,
commands target the team your API key belongs to.

```bash
# Teams
npx @21st-dev/registry team list                            # your teams (slug, role, default)
npx @21st-dev/registry team info acme                       # details, members, pending invites
npx @21st-dev/registry team create "Acme" --description "Design systems"
npx @21st-dev/registry team edit acme --name "Acme Inc"     # owner only
npx @21st-dev/registry team invite dev@acme.com --team acme # email invite

# Registries (slug-addressed within a team)
npx @21st-dev/registry registry list --team acme
npx @21st-dev/registry registry info ui-kit --team acme
npx @21st-dev/registry registry create "UI Kit" --team acme # slug auto-derived: ui-kit
npx @21st-dev/registry registry edit ui-kit --description "Buttons, inputs, cards"
```

Deletion is intentionally not supported from the CLI — use the web Studio.

## License

MIT — see [LICENSE](./LICENSE). Open source, contributions welcome.
