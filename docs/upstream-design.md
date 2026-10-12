# Upstream design notes

Reviewed source revisions:

- [dragonish/Tab-Group-Auto-Sleep](https://github.com/dragonish/Tab-Group-Auto-Sleep/tree/da99412fdfd3e4a1fc235c0216cacc2e63fe988c)
- [theluckystrike/tab-suspender-chrome-extension](https://github.com/theluckystrike/tab-suspender-chrome-extension/tree/4e5d4adc8b35988d237a5bd2f2d2fc183434ace5)

These projects are architectural references. TabSiesta contains original code
and project branding; it does not vendor either implementation. The logo was
supplied by the project owner.

## Tab Group Auto-Sleep

Reviewed its complete background worker, manifest, package configuration, Vite
configuration, README, and repository tree. The source is TypeScript compiled with
Vite and pnpm. Its tiny worker calls native `chrome.tabs.discard()` and checks for
group membership, active/discarded state, and frozen state.

Its current triggers are tab creation and loading, not group collapse. TabSiesta
uses an explicit expanded-to-collapsed transition with the `tabGroups` API.
Loading tabs stay awake, allowing background pages to complete navigation.
Native discard and a small worker are useful design examples; its trigger behavior
is not the requested behavior for this extension.

## Tab Suspender

Reviewed the background worker, content script, manifest, settings script/page,
popup script/page, package configuration, README, architecture notes, and tree.
The project separates page detection, background decisions, and extension UI.
Its full settings page groups timing and protection controls; its popup is much
broader than the stats-only popup requested here.

Its implementation redirects tabs to `suspended.html`. TabSiesta uses native
discard instead. Its background timers use `setTimeout()` and in-memory maps;
TabSiesta uses alarms and `storage.session` for worker restarts.

Its content script reports form changes, but the background `FORM_STATUS` handler
acknowledges them without incorporating the state into `shouldSuspendTab()`.
TabSiesta tests the full form-to-discard path for both triggers.

Other lessons from the inspected source:

- Include password edits and selected files in protection without transmitting
  their values; the upstream excludes these controls.
- Compare select options correctly; selects do not have `defaultValue` like inputs.
- Avoid sending activity messages on every mouse movement or scroll. Inactivity
  here is based on tab selection, and guards publish changed booleans only.
- Use proper hostname boundaries for site exceptions, rather than substring matching.
- Display actual discarded-tab counts rather than a fixed per-tab RAM estimate.
- Verify frame coverage; the referenced manifest does not enable `all_frames`.
- Treat source behavior as evidence. Architecture documentation lists APIs and
  modules that differ from the current implementation.

## Tooling

WXT’s official Svelte template supplies extension entrypoints and manifest
generation on top of Vite. Tailwind’s official Vite plugin compiles static CSS
for the UI pages. The service worker and page guard import neither Svelte nor CSS.

The production manifest is checked through browser tests to ensure WXT’s options
entrypoint emits `open_in_tab: true`.
