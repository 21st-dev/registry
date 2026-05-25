# 21st-registry skill

Source for the `21st-registry` skill referenced on
[https://21st.dev/team/docs](https://21st.dev/team/docs).

A **skill** is a bundle of project-aware context an AI assistant (Claude
Code, Cursor, etc.) loads when it detects something it can help with — in
this case, when the user asks to publish, install, or search components in
a 21st team registry.

## Files

- [`SKILL.md`](./SKILL.md) — the skill content. YAML frontmatter at the top
  is the canonical Claude Code / skills.sh format: `name` + `description`
  drive when the skill triggers, the markdown body is loaded as context.

## Distribution

The [skills.sh](https://skills.sh) CLI (maintained by
[vercel-labs/skills](https://github.com/vercel-labs/skills)) identifies
skills by GitHub `<owner>/<repo>`, so the install command is:

```bash
npx skills add 21st-dev/registry
```

The CLI recursively searches `skills/`, root `SKILL.md`, and `.claude/skills/`
for `SKILL.md` — because our bundle lives at `skills/21st-registry/SKILL.md`
inside this repo, nothing extra is needed beyond pushing the file. Once the
repo is public, the CLI drops `SKILL.md` into `~/.claude/skills/21st-registry/`
(or the equivalent path for other AI assistants).

## Manual install (no CLI)

```bash
mkdir -p ~/.claude/skills/21st-registry
curl -fsSL https://21st.dev/api/skills/21st-registry \
  -o ~/.claude/skills/21st-registry/SKILL.md

# For Cursor:
mkdir -p ~/.cursor/skills/21st-registry
cp ~/.claude/skills/21st-registry/SKILL.md ~/.cursor/skills/21st-registry/
```

Or via the bundled CLI which knows where everything lives:

```bash
npx @21st-dev/registry install-skill --global
```

## What this skill teaches your AI agent

When loaded, the agent knows how to:

- **Publish a component** — `npx @21st-dev/registry ./Button.tsx --description "..."`
- **Install** from a team registry — `npx @21st-dev/registry add @team/slug`
- **Search** the team library before duplicating — `npx @21st-dev/registry search "form"`
- **Pick visibility** — `unlisted` (default), `public`, `private`
- **Target a registry** — `--to <registry-slug>` inside the authenticated team
- **Invite teammates** — `npx @21st-dev/registry invite`
- Common pitfalls (default exports, demo imports, slug collisions)

See [SKILL.md](./SKILL.md) for the full content.
