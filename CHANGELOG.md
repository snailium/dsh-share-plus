# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.1] - 2026-10-23

### Fixed

- **The settings form was squeezed into a narrow scrolling box.** The page
  view's root element carried the `dshshare-card` class, which is the *modal
  share dialog's* frame: `max-width: 460px`, `max-height: 80vh`,
  `overflow: auto`, plus its own border, shadow and padding. Because the page
  already supplies a frame, the whole form rendered as a 460px box inside the
  page's own box — box within box, and scrolling separately. The view now
  carries only `dshshare-settings-view` and adds no frame at all. Measured
  width went from 460px to the full 904px the page offers.

- **The mount fields overflowed their card.** The grid was
  `140px 1fr 180px`, whose fixed tracks total more than the narrow box could
  hold, so the "Access token" input was clipped at the card edge. Columns are
  now proportional `minmax(0, …)` tracks (measured 190 / 423 / 233px, zero
  overflow) and the inputs fill their cell (`width: 100%; min-width: 0;
  box-sizing: border-box`).

- **The responsive breakpoint could never fire.** It was
  `@media (max-width: 768px)`, which tests the *window*, not the form — with a
  1280px window it stayed false even while the form was only 460px wide. The
  view is now a query container (`container-type: inline-size`) and the grid
  collapses on `@container (max-width: 560px)`. Verified at three widths: 900px
  container → 3 columns, 520px → 1 column, 420px → 1 column, all at a 1280px
  viewport.

### Changed

- Sections are separated by a rule instead of each being its own bordered,
  filled box; the mount row is now the only box in the form.
- The duplicate "Add directory" button is gone from the save bar (it stays in
  the mounts section header, where the list it appends to lives).
- The save bar gained a top divider and wraps instead of squeezing its note.


## [0.5.0] - 2026-10-20

### Added

- **Localized plugin display metadata.** The package now ships
  `locale/en.json` and `locale/zh.json`, so the Plugins page shows a real
  title and description ("Share Snapshots & Mounts" / "分享快照与目录挂载")
  instead of falling back to the package name. The locale files are exposed
  through a new `"./locale/*.json"` export so the harness can resolve them,
  and `locale` was added to the published `files` list.

  The harness reads `locale/en.json` as the anchor, requires every file name
  to be a language id, and accepts a `meta` object with `title` and
  `description` — each a non-empty string.

### Changed

- **The settings card is reorganised.** The single flat form became two
  sections — *General Sharing Settings* (technical output, public domain) and
  *Read-Only Directory Mounts* — with a per-mount card showing a live
  serving/invalid badge, the copyable URLs, and the reason a mount is not
  being served. The action bar now groups the add/save/discard controls on the
  left and the read-only note on the right.

  The save path is unchanged: one fenced mutation writes `mounts`,
  `technicalInfo` and `publicDomain` together, and the result is confirmed
  against a read-back rather than trusted from the return value.

  The styles follow the harness theme more closely than before — 73 theme
  variables (up from 51), with every hardcoded colour only a fallback for a
  missing variable.


## [0.4.1] - 2026-10-20

### Fixed

- **Compatibility with dsh 0.2.1-rc.2.** The session format is still v4, but
  that release adds three event types (`job/registered`, `job/settled`,
  `working-directory/change`). Because the plugin recognises event types from
  a hardcoded copy of the harness vocabulary, every share of a 0.2.1 session
  would have raised the false "较新的会话格式 / newer session format" banner.
  The three types are now listed as deliberately ignored.

### Added

- **`tests/vocabulary.test.mjs`** — a conformance test for the event
  vocabulary. It pins the reference vocabularies of every supported harness
  generation (0.2.0-rc.2 with 59 types, 0.2.1-rc.2 with 62) and fails when
  the plugin's list drifts from them: a type the harness writes but the plugin
  does not know (a false banner on every share), a type no harness has (a typo
  hiding a real incompatibility), a rendered type a harness does not define, or
  a declared `dsh.sessionFormat` that does not match. The test is mutation-
  verified in both directions.

  The plugin recognises the **union** of all known vocabularies, so a share
  created on an older harness stays readable on a newer one.


## [0.4.0] - 2026-10-14

### Changed

- **Renamed everything to `dsh-share-plus`.** The loader row id, the settings
  namespace, the Connection RPC channel (`/dsh-share-plus`) and the snapshot
  store file (`dsh-share-plus.json`) now match the package name. Previously the
  row id and channel were still `dsh-share`, so `PACKAGE#ENTRY_ID` produced
  `dsh-share-plus#dsh-share` and the profile had to keep the old id in its patch
  layer. **Action required:** an existing profile's patch layer must rename
  `- id: dsh-share` to `- id: dsh-share-plus`, and the store file must be renamed
  to match — see the migration note in the README.
- Concurrent store writes are now serialized, and each write uses a unique temp
  filename. Two simultaneous mutations previously shared one `${file}.${pid}.tmp`
  path and could corrupt it.
- The client half is a proper ESM default export (`export default` instead of
  `module.exports`); the bundle wrapper unwraps `.default`, so both shapes work.
- `primaryLanIPv4()` caches its UDP route probe for 30s. On an offline or
  isolated network the probe always times out after 1.5s, and it ran on every
  share and status call.

### Added

- Expired shares are swept hourly (and by `ShareStore.cleanExpired()`), so a
  snapshot with an expiry no longer lingers on disk until the next mutation.

### Fixed

- **A truncated private-key block is redacted again.** The rule had been narrowed
  to match only well-formed blocks ending in `-----END ...-----`, so an
  unterminated key — the common case when a session was trimmed or tool output
  was cut — passed through unmasked. The `|$` alternative is restored and
  covered by a regression test.

## [0.3.3] - 2026-10-14

### Added

- **`dsh.sessionFormat: 4`** in the package manifest. The plugin's real
  compatibility contract is the session RECORD FORMAT, not a harness version: it
  renders four event types (`user/message`, `assistant/message`, `tool/result`,
  `tool/call`) out of the format-4 vocabulary and reads the session store through
  `ctx.sessionQuery`. It is declared here rather than as a `peerDependency`
  because the owning package (`@deepseek-ai/dsh-session`) is never imported at
  runtime and is not resolvable from a profile — a peer would only produce an
  unsatisfiable install warning.
- The share page now reports a session written by an **unknown format** instead
  of silently rendering short: "此分享的部分内容使用了较新的会话格式（N 条记录未
  渲染）". The fold step compares each event type against the 59-entry format-4
  vocabulary, counting types that are in neither the rendered nor the
  known-ignored set. Ordinary format-4 events (`step/start`, `llm/retry`,
  `turn/start`, …) never raise it, so no real session cries wolf.

### Changed

- `@deepseek-ai/schemastery` moved from `dependencies` to `devDependencies`. It
  is inlined into `lib/index.js` at build time (the harness identifies a schema
  by its `~standard.vendor` string, so an inlined copy is equivalent to the
  host's), so consumers never resolve it — declaring it as a runtime dependency
  only installed a redundant, possibly version-skewed copy. The published host
  bundle now resolves **zero** bare specifiers: `node:` builtins only. It stays
  a devDependency because the build itself needs it.


## [0.3.2] - 2026-10-14

### Fixed

- Documentation and packaging only; no runtime behaviour changed. First release
  published through npm Trusted Publishing (OIDC) with provenance.

## [0.3.1] - 2026-10-14

### Added

- **Public domain setting** (`publicDomain`, editable live from the plugin's
  settings card as **绑定域名 / Public domain**). When set, every generated link
  leads with `https://<domain>/...`, so shares open from the internet through a
  reverse proxy or tunnel; the LAN addresses stay in the list as fallbacks for
  devices on the same network. The plugin only *names* the domain — it opens no
  port and installs no certificate.

### Changed

- Share and mount URLs are now derived at read time from the current domain and
  bound port. The store keeps only the token, never a URL, so **existing shares
  follow a domain change immediately** — no migration and no restart.
- The share dialog tags each URL as 互联网 / 局域网 / 本机 (Internet / LAN /
  loopback) instead of assuming every entry is a LAN address.
- The settings card lists every URL a mount reports (public first, then the LAN
  fallbacks), each with its own copy button, instead of only the first one.

### Fixed

- The share server binds at boot as soon as there is anything to serve (a
  persisted share or a configured mount). It previously started lazily on first
  use, so a restarted dsh left an existing share URL dead until someone opened
  the share dialog again.

## [0.3.0] - 2026-10-14

Internal milestone for the public-domain work; superseded by 0.3.1 before any
package was published.

## [0.2.0] - 2026-10-13

### Added

- Directory mounts: serve a local directory (APK builds, release artifacts) over
  the share server, with listings, byte ranges, ETags and per-mount tokens.
- Isolated end-to-end profile and an offline test battery.

### Changed

- Share pages are readable by default: prompts and the final answer only, with
  tool calls, injected context and stats opt-in behind `technicalInfo`.

[Unreleased]: https://github.com/snailium/dsh-share-plus/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/snailium/dsh-share-plus/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/snailium/dsh-share-plus/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/snailium/dsh-share-plus/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/snailium/dsh-share-plus/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/snailium/dsh-share-plus/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/snailium/dsh-share-plus/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/snailium/dsh-share-plus/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/snailium/dsh-share-plus/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/snailium/dsh-share-plus/releases/tag/v0.2.0
