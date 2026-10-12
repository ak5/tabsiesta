# TabSiesta

Read README.md, docs/index.md, and CONTRIBUTING.md before changes. Documentation
ownership and the dev/main release policy live in docs/conventions.md.

## Development

- WXT + Vite, Svelte 5, strict TypeScript, Tailwind 4, pnpm.
- Source entrypoints: `src/entrypoints`. Shared policy/settings: `src/lib`.
- Run `pnpm check`, `pnpm lint`, `pnpm test`, and `pnpm build` for changes.
- `pnpm test:e2e` uses isolated Chrome for Testing. Never use the user's real
  browser profile for automated discard tests.
- `pnpm dev` picks a free port and writes `.env.dev-slot`; stop it after verification.
- Do not hand-edit `.output` or `.wxt`; these are generated.

## Invariants

- Only `chrome.tabs.discard(tabId)` may sleep tabs. No URL replacement pages.
- All sleep triggers, including audit actions, must use the shared engine and every protection check.
- Unknown page/frame state keeps a tab awake. Selected tabs are always protected.
- Never persist or transmit page text, secrets, or form values.
- Recommended phrase IDs are permanent; introduce new recommendations with new IDs.
  Upgrades preserve custom entries, edits, removals, and disabled recommendations.
- Keep the popup stats-only; settings belong in the full-tab options page.
- Prefer forward-looking documentation and original implementations/assets.
- Use Chrome control or terminal-compatible verification; never the in-app browser.

## Scratch and contributions

- Use ignored root `tmp/<task-name>/` for disposable scratch work, never secrets.
- Promote durable artifacts to their owned tracked paths; clean up only your files.
- Keep AGENTS.md and CLAUDE.md byte-identical.
- Target dev for feature PRs; release dev to main with a merge commit.
- Never rewrite dev, main, or another contributor's branch.
