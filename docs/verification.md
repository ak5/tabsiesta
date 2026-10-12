# Verification

## Completed

- `pnpm check`: TypeScript and Svelte checks pass with zero errors or warnings.
- `pnpm lint`: passes.
- `pnpm test`: 121 tests pass across six files.
- `pnpm zip`: production build and Chrome distribution packaging pass.
- The TabSiesta rename passes all checks above; generated manifest and ZIP use
  the new name. Documentation links, shared agent parity, SVG syntax, and CI YAML
  were checked. Targeted credential and personal-path scans found no matches.
- CI contains verification and isolated-browser jobs; no GitHub run has occurred.
- Branding uses the supplied TabSiesta logo with a clean circular alpha boundary
  and fully transparent corners.
  Original and production assets contain no ancillary PNG metadata. Icons are
  exported at 16/32/48/128 px. Main text/accent color pairs exceed 4.5:1 contrast
  in light and dark themes. Chrome-rendered options/mobile/popup screenshots from
  the isolated test run were reviewed; toolbar popup dimensions still need a
  manual check.

Test coverage includes the shared discard engine, actual worker event handlers
with mocked Chrome APIs, document form/phrase detection, recommendation updates,
session lifecycle, and mounted Svelte settings/popup behavior in jsdom.
It explicitly checks both triggers, dirty child frames, missing guard coverage,
preservation of existing guards when injecting a missing frame, same-URL navigation,
settings races, password/file edits, form reset semantics, crypto warnings, custom
phrase restoration, and options messages after section navigation. Worker tests
also cover startup with no browser windows, groups created afterward, and groups
removed during startup. Initialization resolves groups by ID from the tab snapshot
instead of using the current-window-dependent `tabGroups.query()` API.
Audit coverage checks filters/search, authenticated access, cached protection,
recorded idle/group causes, unknown external discards, and session-only metadata.
It also checks configured keyword IDs, sticky match attribution, phrase deep links,
manual sleep guardrails, action sender/ID validation, tab-title focus,
and closing only the requested tab. A replacement regression verifies that sleep
reasons use the ID returned by native discard and retain inactivity timestamps.

## Browser verification outstanding

The isolated Terminal run produced two passing cases: options/popup behavior and
form/subframe/phrase protection. Five cases failed: four used stale tab IDs after
native discard, and the audio fixture never reported audible playback. Sleep
metadata and those test assumptions have been corrected; the updated seven-case
suite needs a fresh run before claiming browser safety verification.

Chrome-control remains disconnected. Browser launches from the agent environment
abort at startup (`SIGABRT`; process control also reports `EPERM`). These startup
failures are separate from the Terminal run's test failures.

The crash stack ends in macOS `TransformProcessType` / `_RegisterApplication` /
`abort`, matching Chromium's headless background-application initialization. This
occurs before the extension loads; the report does not identify why registration
fails. Do not copy full machine crash reports into the public repository.

The suite includes forms/child frames/phrases, group isolation, audio/pinned/site/
selected protection, audit keyword links and actions, and a real five-minute idle
alarm. TypeScript, lint, and the 121 non-browser tests pass. Restart/reload and
inaccessible-frame cases additionally need manual Chrome checks.

The browser test suite is included under `e2e/`. Run it on a machine where Chrome
for Testing can launch:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

It uses a temporary profile and in-memory fixture responses. It does not touch an
existing signed-in profile or start a development server. See the user guide for
manual unpacked-extension checks and the executable-path override.

## Publication outstanding

The local folder remains `tabsuspend`; project identity is TabSiesta. Git is
initialized locally. The environment rejects outside-sandbox GitHub CLI execution;
remote publication, CI execution, and branch protection remain unverified.
