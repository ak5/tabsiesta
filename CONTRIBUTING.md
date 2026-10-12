# Contributing to TabSiesta

Use issues for reproducible bugs and focused proposals. Include Chrome version,
extension version, relevant settings, expected behavior, and actual behavior.
Use synthetic pages and redact URLs, page titles, drafts, and secrets.
See [SECURITY.md](SECURITY.md) for sensitive reports.

## Local setup

Follow the [README](README.md#install-development), then run:

```sh
pnpm check
pnpm lint
pnpm test
pnpm build
```

Changes to discard behavior or page guards also need the isolated browser suite:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Explain any verification limitation in your PR. Never use a real signed-in
profile for automated discard tests.

## Pull requests

Target `dev`. Keep one purpose per PR and update behavior docs with code changes.
Before integration, rebase your own feature branch onto current `dev`, rerun
checks, and use `--force-with-lease` if you need to update its remote history.
Never rewrite `dev`, `main`, or another contributor's branch.

A PR is a proposal, not a promise of integration. Merge-ready changes normally
rebase-merge into `dev`; every preserved commit must pass independently. Authors
verify the series, while CI checks the final PR head. Maintainers may split,
reconstruct, replace, or reject a proposal. Material rewrites use a separate
integration branch and require fresh checks and review. Meaningful author and
co-author attribution follows the accepted work.

Releases use a merge-commit PR from `dev` to `main`. Production fixes return to
`dev` by merging `main` into `dev`. See [conventions](docs/conventions.md).

## Safety invariants

- Use only native `chrome.tabs.discard()` for sleep.
- Apply the shared policy to every sleep trigger.
- Unknown frame or page safety keeps tabs awake.
- Never store, log, or transmit page text, form values, or secrets.
- Preserve custom phrases and user choices during recommendation updates.
- Keep generated output and scratch files out of commits.
