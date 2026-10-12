# User and developer guide

A small, open-source Chrome extension that sleeps idle tabs and collapsed tab
groups using Chrome’s native discard API. Sleeping tabs retain their addresses
and icons. Selecting one reloads it; opening a group does not reload all its tabs.

Built with WXT, Vite, Svelte 5, strict TypeScript, Tailwind CSS 4, and pnpm.
Licensed under MIT. No telemetry, remote code, external fonts, or browsing history.

## Load it locally

Requirements: Node.js 22.12 or newer, pnpm 10, and Chrome desktop 121 or newer.

1. In this directory, install dependencies:

   ```sh
   pnpm install --frozen-lockfile
   ```

2. Build the extension:

   ```sh
   pnpm build
   ```

3. Open this complete URL in Chrome: `chrome://extensions/`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**, then select this project’s `.output/chrome-mv3`
   directory, which contains the generated `manifest.json`.
6. Pin TabSiesta using Chrome’s Extensions menu. Its popup shows current counts
   and opens the full-tab **Options** page.

After changing source code, rebuild and click the extension’s Reload button at
`chrome://extensions/`. Already-open web pages receive a guard when checked;
populated editors are treated conservatively on late injection.

## What it does

- **Idle sleep:** the default threshold is 10 minutes, with 5, 30, and 60-minute
  choices. Inactivity starts when a tab stops being selected in its window.
  A global alarm checks every minute; Chrome can delay alarms during sleep.
- **Group sleep:** collapsing an expanded group immediately evaluates its tabs.
  Changing a collapsed group’s name or color does not retrigger sleeping.
- **One shared policy:** automatic triggers and audit Sleep protect selected tabs in every window,
  dirty forms, sensitive phrases, protected sites, manually protected tabs,
  and pages whose safety cannot be checked. Loading, frozen, already-discarded,
  and unsupported pages are skipped.
- **Audio/pinned protection:** enabled by default and individually configurable.
- **Stats only:** the popup shows total, loaded, sleeping, and protected loaded
  tabs across all windows. Counts are a snapshot, not a stored history. Protected
  includes selected tabs and pages whose guard state is not verified yet. A tab
  protected for several reasons is counted only once.
- **Tab Audit:** open the full-page view from the popup or options sidebar.
  Filter All, Sleeping, or Awake, search titles/sites/reasons, and Refresh the
  snapshot. Awake reasons use current tab properties and cached page safety;
  loading or refreshing the audit never injects page scans or sleeps tabs. It shows
  the first matching protection rule, plus known warning phrases linking directly
  to their highlighted settings entries. Unknown safety results distinguish absent
  frame coverage, initializing checks, incomplete scans, and frame access failures.
  Eligible tabs show whether the idle threshold is reached.
  Sleeping tabs show idle timer, group collapse, or audit Sleep when TabSiesta recorded that
  discard in this browser session. Other sleeping tabs have an unknown cause.
  **Sleep** performs a fresh safety check and bypasses only the idle deadline;
  protected tabs remain awake with an explanation. **Close** closes the selected
  row's tab. Click a **tab title** to switch to that existing tab and focus its
  window. Switching wakes a sleeping tab without opening a duplicate.

There are no placeholder pages or synthetic memory-saving estimates. Chrome may
refuse a discard; failures do not prevent other eligible tabs from being checked.

## Protecting work and secrets

The page guard monitors normal inputs, passwords, file selection, textareas,
checkboxes, radio buttons, selects, and editable content, including child frames.
It sends safety booleans and matched configured phrase IDs, never page excerpts.
A submit event does not prove an application saved
your draft, so protection remains until a successful form reset or a new document.
Removing an editor from an SPA also does not prove it was saved.

Sensitive-phrase protection is enabled by default. Recommendations cover one-time
keys, recovery codes, and crypto seed/private-key warnings. Customize the list
in Options. Matching is literal, case-insensitive, and normalizes whitespace,
typographic apostrophes, and hyphens. Regex syntax has no special meaning.
A detected warning protects that document even if the warning is dismissed.
Turning off the phrase guard bypasses that protection; re-enabling it restores
the document’s sticky protection. A new document begins a new check.

- **Add, edit, or disable phrases; remove custom phrases.** Recommended phrases
  have no remove control. Editing a recommendation creates a custom variant and
  suppresses the original.
- **Restore recommended phrases** restores current bundled defaults while
  preserving custom entries, edited variants, and their enabled states.
  Equivalent text is deduplicated; a custom duplicate retains its state.
- **Add new recommended phrases on update** is checked by default. An extension
  update adds recommendations with previously unseen IDs; it respects prior
  removals, edits, and disabled entries. Updates skipped while this option is off
  are not added retroactively when it is re-enabled. Restore is available anytime.
- **Never sleep these sites** accepts hostnames, protecting exact hosts and all
  their subdomains. `example.com` does not match `notexample.com` or
  `example.com.other.test`. No wildcards, ports, or paths are accepted.
  New installs seed the visible list with Gmail, Google Docs/Drive/Chat/Meet,
  Outlook, Slack, Notion, and Bitwarden/1Password vault hosts. All entries are
  removable; there are no hidden site exceptions. Existing installs and updates
  retain their saved lists. **Add suggested sites** adds the current starter hosts
  without deleting custom entries or adding duplicates. Save to apply.
  The starter app hosts follow vendor documentation for
  [Google Workspace](https://support.google.com/a/users/answer/9333810),
  [Outlook](https://support.microsoft.com/en-us/outlook/getstarted/what-version-of-outlook-do-i-have),
  [Slack](https://slack.com/help/articles/221769328-Locate-your-Slack-URL-or-ID),
  [Notion](https://www.notion.com/help/network-control),
  [Bitwarden](https://bitwarden.com/help/getting-started-webvault/), and
  [1Password](https://support.1password.com/sign-in-troubleshooting/).
  Self-hosted vaults and organization-specific hosts must be added by the user.
- **Keep this tab awake** is a checkbox in the web page’s right-click menu.
  Protection follows that tab across navigation and window moves, until it closes.
  Session-scoped tab protection is cleared when Chrome starts a new session.

Changes on the options page are drafts until **Save changes** is clicked.
**Restore behavior defaults** preserves phrase and site lists. Restoring phrases
is a separate action.

### Detection boundaries

No heuristic can identify every unsaved application state. Custom canvas editors,
closed shadow roots, unfamiliar wording, and languages absent from your phrase
list may escape detection. A phrase can also occur in an ordinary article, keeping
it awake unnecessarily. Use site or tab protection for important pages.

Hidden/script/style content and field values are excluded from phrase matching.
Large pages have bounded scans; an incomplete scan keeps the tab awake. Checks are
debounced for dynamic content and performed again before discarding. Very brief
warnings can disappear between checks. Form and phrase protection never stores
the secret itself, and the extension does not attempt to restore form values.

Chrome does not provide an atomic “discard only if the document is still safe”
operation. We recheck activation, navigation, settings, and group state just before
discarding, but a final race remains possible. These protections govern TabSiesta;
they cannot prevent crashes, manual reloads, Chrome Memory Saver, or another
extension’s actions. TabSiesta does not change Memory Saver settings.

## Permissions and privacy

| Permission | Purpose |
| --- | --- |
| `tabs` | Read tab state/URLs, manage lifecycle, and discard explicit tab IDs. |
| `tabGroups` | Observe collapse state and query groups. |
| `alarms` | Run restart-safe periodic idle checks. |
| `storage` | Save device-local settings and session-scoped state. |
| `scripting` | Check existing guards and inject them into already-open pages. |
| `webNavigation` | Confirm every frame/document was inspected without navigation. |
| `contextMenus` | Offer per-tab Keep awake protection. |
| HTTP/HTTPS site access | Inspect forms and visible warning phrases on ordinary web pages. |

Missing site access or inaccessible child frames prevents suspension. Chrome
internal pages, extension pages, and local `file:` pages are not suspended.
Settings are in `storage.local`; idle clocks, group state, manual flags, and
frame protection booleans, matched configured phrase IDs, and sleep trigger/timestamps
are in `storage.session`. Settings do not sync to another
device. Neither storage area contains page text, form values, secrets, or browsing
history. Tab URLs are read for eligibility but not persisted. The audit receives
current titles and URLs transiently; it displays titles and hostnames without
loading favicons or contacting sites. Refresh replaces its in-memory snapshot.

Custom warning phrases and protected hostnames are saved as settings. Add warning
wording, never actual tokens, keys, or recovery words. Settings are not encrypted
by this extension. Editable-content comparisons use a transient in-memory
baseline inside the page guard; that baseline is never sent to the worker.

## Development and checks

```sh
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm zip
```

`pnpm zip` writes an installable distribution ZIP to `.output/`. WXT generates
`background.js`, `popup.html`, `options.html`, `audit.html`, bundled scripts, and `manifest.json`.
Source entrypoints live in `src/entrypoints`; shared policy, settings, session
state, and guard modules live in `src/lib`.

`pnpm dev` selects a free loopback port and writes its URL to `.env.dev-slot`.
It does not launch a browser automatically. Read the generated port file, then
load `.output/chrome-mv3-dev` in Chrome for live development. The OS reservation
is released before Vite binds; a rare intervening collision causes startup to fail
rather than taking over an occupied port. Stop with Ctrl+C when finished.

The supplied TabSiesta artwork is in `docs/assets/`. Extension icons are exported
from `logo.png`; normal builds use the committed exports. To regenerate on macOS:

```sh
python3 scripts/generate-icons.py
```

### Real Chrome tests

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

The tests use an isolated, temporary Chrome for Testing profile with the built
extension. Fixture pages are served from memory; no server is started and no
external websites are visited. The profile is deleted after testing. Screenshots
are written to `test-results/`. Browser launch must be permitted by your environment.
To use an existing Chrome for Testing binary, set `CHROME_TEST_EXECUTABLE` to its
absolute executable path.

The suite covers full-tab options, saved settings, preserved custom phrases,
responsive/dark layouts, popup counts, native collapse discards, restoration on
activation, form/subframe/secret-page protection, group isolation, actual playing
audio, pinned/selected/site exceptions, and audit keyword links/actions. The idle
case waits for a real five-minute threshold and Chrome alarm; it does not mock
time, so allow approximately six minutes for the suite. Unit tests additionally
cover idle thresholds, worker-state serialization, upgrades, races, missing guards,
and trigger coordination.

Native discard can replace a tab's internal ID. Sleep records follow the returned
tab ID, while audit title actions always target the current snapshot. The audio
case uses a quiet generated tone with browser-wide muting disabled so Chrome can
report actual audible playback.

Chrome restart/extension reload behavior and inaccessible-frame safety still need
manual browser checks in addition to this suite.

For manual validation: group several ordinary background tabs, collapse the group,
and inspect their state at `chrome://discards/`. Repeat with an edited form, an
audible tab, a pinned tab, and a page containing a recommended phrase. Eligible
ordinary pages should sleep; protected ones should retain their state. For idle
behavior, select 5 minutes, switch away from a clean page, and wait for the next
alarm after its threshold. Recheck with collapse sleep disabled.

See [upstream design notes](upstream-design.md) for the source references and
design decisions that informed this implementation, and
[verification notes](verification.md) for completed checks and remaining
browser verification.
