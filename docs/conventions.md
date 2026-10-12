# Repository conventions

## Repository bootstrap

TabSiesta is a small, maintained Chrome extension. One pnpm package owns the
application; WXT generates the extension distribution. The setup includes indexed
docs, contributor/security guidance, CI, and matching agent instructions. Teaching
skills, deployments, and release automation are outside the current scope.

`pnpm` scripts own setup, checks, tests, and builds. No second task runner is needed.
Commit source and the lockfile; do not edit or commit `.output` or `.wxt`.

## Branches and releases

`dev` collects work; `main` represents production. Feature PRs target `dev` and
normally rebase-merge after author-owned updates and checks. Each retained commit
must pass independently. Releases use a **merge commit** from `dev` to `main` so
the source SHA remains an ancestor of production. Do not squash or rebase a
release PR, rewrite either long-lived branch, or require linear history on `main`.
Hotfixes enter `main` through a PR and return through a `main` → `dev` merge.
Review applies to the latest revision; material rewrites invalidate earlier review.

Before releasing, complete checks, browser safety validation, and review of the
release diff. After merging, verify the recorded source SHA is an ancestor of
`main` with `git merge-base --is-ancestor <source-sha> main`.

GitHub creation, default branch, and protection enforcement are currently
**unknown**: outside-sandbox GitHub CLI access was rejected by the execution
environment. These are intended conventions, not claims of configured rules.

## Documentation ownership

README owns identity and quick start. `guide.md` owns behavior, permissions, and
detection limits. Settings/guard/engine changes must update that guide when user
behavior changes. Verification notes own test evidence. CONTRIBUTING owns the
human workflow; AGENTS and CLAUDE contain the same agent contract.

## Scratch workspace

Use root `tmp/<task-name>/` for disposable intermediate files. `/tmp/` is ignored
to keep scratch work out of commits. Promote retained material into its proper
tracked location. Never use scratch files to store secrets, and clean up only
files created by your task.

## Branding

Use the supplied TabSiesta sleeping-tabs/sombrero logo. `docs/assets/logo-original.png`
preserves the supplied pixels without ancillary metadata; `logo.png` is the
production version with a clean transparent circular edge. `public/icons` contains small committed exports,
so full-resolution artwork is not bundled into the extension. Export on macOS with
`python3 scripts/generate-icons.py`; normal builds need no image tools.

UI colors follow the artwork: sunset amber, warm cream, and deep navy. Keep text
contrast readable in both color schemes. The popup remains stats-only; decoration
must not introduce a UI framework or artwork into the background/page guard.
