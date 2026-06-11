# Changelog

## 0.0.9 — 2026-06-11

- New `team` command group: `list`, `info`, `create`, `edit`, `invite <email>` — view, create, and edit your teams and invite members without leaving the terminal.
- New `registry` command group: `list`, `info`, `create`, `edit` — manage team registries, addressed by slug within a team.
- `--team <slug>` flag on team/registry subcommands to target any of your teams (default: the team your API key belongs to); `--json` on all subcommands for machine-readable output.
- Team JSON output is limited to a safe field whitelist (no integration payloads).
- List outputs (`team list`, `team info` members, `registry list`) render as aligned text tables.
- Requires 21st.dev backend with tRPC API-key support (deployed 2026-06-11); on older backends the new commands return "Not authenticated".

## 0.0.6 — 2026-06-04

- Add `--runtime expo` publishing support for Expo / React Native components.
- Include component-only npm dependencies in the installable registry item while keeping demo-only dependencies limited to the publish sandbox.

## 0.0.5 — 2026-06-04

- Preserve local support files when publishing components and demos, including shared component/demo dependencies.
- Normalize single-demo publishes to the `default` demo slug.

## 0.0.4 — 2026-06-03

- Print canonical component URLs after publish, falling back to `/community/components/{username}/{slug}` if the API response does not include a URL.
- Update the bundled `21st-registry` skill with the latest publish URL and shadcn registry setup instructions.

## 0.0.1 — 2026-04-30

Initial release.

- `publish` — push a React component (with auto-detected demo) to a private team registry on 21st.dev.
- `add @user/slug` — install a component into the current project (writes file + runs the project's package manager).
- `search "<query>"` — semantic search across the team library.
- `invite` — print a shareable invite link for the team.
- `install-skill` — install the bundled SKILL.md into `~/.claude/skills/` and `~/.cursor/skills/` for any AI agent that supports the Anthropic SKILL.md format.
- `print-skill` — print the bundled SKILL.md to stdout.
