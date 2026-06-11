---
name: 21st-registry
description: Publish a React component to the user's team library on 21st.dev so teammates can install it with a single command, or install an existing one. Triggers when the user says things like "publish/share/upload this to 21st", "залей в наш регистр", "опубликуй компонент", "share with team", "make this reusable", "install our Button", "use the team button".
---

# Publish & install components in the 21st team library

Use this skill in **two directions**: publishing a component for the team, and installing one the team already shared.

## Pre-flight (always)

1. Check auth: `API_KEY_21ST` env is set, or the registry CLI has saved credentials. If neither — tell the user to run `npx @21st-dev/registry login` once. Don't try to log them in yourself.
2. The CLI is `@21st-dev/registry`. Don't reinvent — use it.

---

## Publishing a component

### Decide visibility — default to unlisted in a registry

| User says… | Visibility |
|---|---|
| "share with team", "залей нам", "publish internally", default for any unqualified ask | unlisted in the selected/default registry (no visibility flag needed) |
| "share publicly via link / on my profile, but don't list it in the library" | `--unlisted` |
| "publish publicly", "make it public on 21st" | `--public` |
| "restrict to the registry team", "private team draft" | `--private` |

**Never use `--public` without explicit user instruction.** Public components go through admin moderation and appear in the 21st library. `--unlisted` is the safe option when the user wants a shareable URL but doesn't want a library listing.

### Standard publish

The CLI's positional file path triggers auto-detection — name from the default export, slug from the filename, tags from imports, demo auto-found or synthesised. So in 95% of cases this is enough:

```bash
npx @21st-dev/registry ./path/to/Component.tsx \
  --to default \
  --description "1-2 sentences about what it does and when to use it"
```

### Flag reference

| Flag | When to use |
|---|---|
| `--name "Display Name"` | Override the auto-detected name. Default is humanised version of the default-export name. |
| `--description "…"` | **Required.** 10+ chars. Write a real description — what it does and when to use it. Never fabricate; if you don't know, ask the user. |
| `--tags "form,input,validation"` | 1-5 lowercase tags. Default: detected from imports (lucide-react → "icon", framer-motion → "animation", etc). Only override if the auto-detected ones miss the point. |
| `--slug my-button` | Override the URL slug. Default: kebab-case from name. |
| `--demo ./Component.demo.tsx` | Demo file. Auto-detected by these patterns: `{Component}.demo.tsx`, `demos/{slug}.tsx`, `demos/default.tsx`. If none exist, the CLI synthesises a trivial `<Component />` demo automatically — fine for v1, but a real demo gives a much better preview. |
| `--preview ./preview.png` | **Optional.** The team library uses a live iframe preview; a static image is only needed if you want a snappy thumbnail. |
| `--to <registry-slug>` | Target a specific registry in the authenticated team (e.g. `--to default`). If omitted, the server uses the team's first/default registry. |
| `--public` / `--unlisted` / `--private` | Override component visibility. |

### What the user gets back

```
✅ https://21st.dev/community/components/{username}/{slug}
Install in another project:
  npx @21st-dev/registry add @{username}/{slug}
```

### Updating an existing component

Same command, same slug → upsert. The CLI prints "Updated" instead of "Published". No version flag needed; teammates always get the latest.

If the user says "I want a NEW component, not an update" but slug collides — confirm with the user before overwriting; suggest changing `--slug`.

---

## Installing a component

Two address formats are accepted:
- `@team-slug/component-slug` — install from a team registry (preferred for team-shared)
- `@username/component-slug` — install from a user's personal/public components

```bash
npx @21st-dev/registry add @acme/animated-button
# or
npx @21st-dev/registry add @serjobas/animated-button
```

The CLI:
1. Fetches the registry JSON and component file (server resolves `@handle` against team-slug first, then username)
2. Writes it to the project (`components/ui/{slug}.tsx` by default)
3. Runs `pnpm/npm/yarn/bun add` for any npm dependencies
4. If it depends on other 21st components, prints them — install with `add` separately

For shadcn directly, public/unlisted components can use the plain registry item URL:

```bash
npx shadcn@latest add "https://21st.dev/r/acme/animated-button"
```

For repeat installs or private components, register the 21st registry in the consumer project's `components.json` and use a Bearer token:

```json
{
  "registries": {
    "@YOUR_NAMESPACE": {
      "url": "https://21st.dev/r/acme/default/{name}.json",
      "headers": {
        "Authorization": "Bearer ${API_KEY_21ST}"
      }
    }
  }
}
```

Then install with the stock shadcn CLI:

```bash
npx shadcn@latest add @YOUR_NAMESPACE/animated-button
```

`@YOUR_NAMESPACE` is just the local alias from `components.json`; choose any clear slug. Do not commit real API keys into `components.json` unless the user explicitly wants that local file to contain a personal key.

Flags:
- `--force` — overwrite existing file
- `--no-install` — skip npm install step (just write files)
- `--dir PATH` — install into a different project directory

---

## Searching the team library

When the user wants a component but doesn't know the exact name:

```bash
npx @21st-dev/registry search "<query>"
```

Default scope is `team` (your team's library). Use `--scope mine` for just your own, `--scope public` for the public library.

**Always search before publishing if there's a chance a similar component already exists.** Don't add duplicates to the team library.

```bash
npx @21st-dev/registry search "button" --scope team
# Prints list with @user/slug refs you can pass to `add`.
```

---

## Managing teams & registries

View, create, and edit teams and registries from the CLI (no deletion — that
stays in the web Studio). Every subcommand accepts `--json`; prefer it when
you need to parse the output. Teams are addressed by slug with `--team <slug>`
(default: the team the API key belongs to).

```bash
# Inspect before acting
npx @21st-dev/registry team list --json            # all teams: slug, role, default
npx @21st-dev/registry team info [team]            # members + pending invites
npx @21st-dev/registry registry list --team <slug> --json

# Create
npx @21st-dev/registry team create "<name>" [--description TEXT]
npx @21st-dev/registry registry create "<name>" [--slug SLUG] [--description TEXT] [--team SLUG]
# registry slug is auto-derived from the name if --slug is omitted

# Edit
npx @21st-dev/registry team edit [team] --name TEXT --description TEXT   # owner only
npx @21st-dev/registry registry edit <slug> --name TEXT --description TEXT

# Invite a collaborator by email
npx @21st-dev/registry team invite <email> [--team SLUG]
```

Typical flow before publishing a new component group: `registry list --json`
to see what exists → `registry create "Marketing blocks"` if needed →
`publish --to marketing-blocks`.

---

## Hard rules for agents

- ❌ **Never** use `--public` without an explicit "publish publicly" from the user.
- ❌ **Never** fabricate a description. Ask the user, or read the code carefully.
- ❌ **Never** include API keys, env values, or hardcoded internal URLs in the component file you publish.
- ❌ **Never** publish a file with unsaved edits — flush first.
- ✅ **Always** search before publishing if a similar component might already exist.
- ✅ **Always** add a useful demo file with realistic props if you can; only fall back to the auto-synthesised one as a last resort.

## Common mistakes to avoid

1. **Demo imports the component via a wrong path.** The CLI auto-rewrites relative imports (e.g. `import X from "../component"`) to `@/components/ui/{slug}` before upload — so write demos with **relative imports** to the user's source file, not aliases. The CLI will sort it out.
2. **Slug doesn't match between publishes.** If the user renames the file, the auto-derived slug changes and you'll create a duplicate. Pass `--slug` explicitly when re-publishing under a stable name.
3. **Component lacks a default export.** This will fail with a clear error — refactor the component to `export default function ComponentName(...)` first.
