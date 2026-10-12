# Privacy audit

## Scope and result

Reviewed the working tree, all 60 publishable files, available Git history and remotes,
production extension, ZIP contents, icon metadata, manifest permissions, message
handlers, storage writes, page detection, logging, and repository ignore rules.
Pattern searches checked credentials, configured personal identity, private local
paths, embedded URL credentials, and email addresses. No dedicated external secret
scanner was available; this was a manual and pattern-based audit.

No real credentials, configured personal identity, or private machine paths were
found in publishable files or production artifacts. The credential-looking test
URL is a synthetic `example.com` fixture. Icons contain only PNG image chunks,
with no text or EXIF metadata. Production output has no source-map files.
Public links to the requested repository owner are intentional attribution.
The supplied original logo and transparent production version have also had
ancillary PNG metadata removed. Full-resolution artwork lives in docs; only small
icon exports are bundled with the extension.

Repository-local Git identity is configured as the `ak5` handle and GitHub no-reply
email. Publication must verify author and committer metadata rather than inherit
personal global Git settings. The publication helper also repeats these checks
before pushing.

## Runtime data flows

- No application fetch, XHR, WebSocket, beacon, telemetry, remote script, remote
  font, externally-connectable handler, or web-accessible resource was found.
- Page guards run in Chrome's isolated content-script context. Form values and
  visible text are inspected locally. Editable text may have a transient comparison
  baseline; it does not leave the page guard.
- Page-guard messages and guard results contain four safety booleans and optional
  configured phrase IDs. The worker explicitly copies permitted fields and accepts
  only IDs from current settings, dropping unknown IDs and unexpected properties.
  No matched page excerpts are sent. Regression tests cover both ingestion paths.
- Extension UI requests are restricted to this extension's popup/options/audit URLs;
  guard messages require this extension's identity and a current frame/document.
- Local storage contains user settings, including custom warning wording and
  protected hostnames. Session storage contains tab/window/group IDs, idle
  timestamps, document IDs, manual flags, safety booleans, matched configured phrase
  IDs, and sleep triggers/times. URLs, tab titles,
  form values, and scanned page text are not written to storage.
- The audit sends current tab titles and URLs to its own extension page in memory
  for the requested snapshot. It renders escaped titles and hostnames, without
  external favicon loads, page scans, or remote requests.
- Sleep/Close/Focus actions are restricted to the audit extension page and
  validated numeric tab IDs. Sleep uses the shared guarded engine. Clicking a
  title activates the existing tab/window without opening another copy.
- Worker logs and failure responses use fixed text instead of raw API exceptions,
  which can contain URLs or other contextual details. Regression tests verify this.
- Build/dependency installation and CI can contact package registries, GitHub, and
  browser download services. Those development activities are separate from the
  installed extension's runtime.
- Vite's module-preload fetch fallback is disabled because supported Chrome
  versions preload modules natively. Bundled URL strings used for SVG namespaces,
  framework error references, license comments, and hostname parsing are not
  remote resource requests.

## Publication boundaries

Scratch notes, machine measurements, browser test output, generated distributions,
dependencies, and environment files are ignored. Review the exact Git index before
each push; ignored files can still be included if someone explicitly force-adds them.
Publish the extension ZIP, not an archive of the entire working folder.

The extension still requires site access to perform safety checks. Locally stored
settings are not encrypted by the application, and users should enter warning
wording rather than real secrets in the phrase list.

## Limits

Static review and mocked tests do not prove the absence of every possible leak.
Live Chrome traffic inspection and real-browser tests could not be completed in
the current execution environment. No actual browser profile, installed settings,
or remote GitHub history was inspected. Third-party dependencies were not each
audited line by line. Repeat this review when runtime dependencies, permissions,
logging, storage, or network behavior change.
