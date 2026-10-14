# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/snailium/dsh-share-plus/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/snailium/dsh-share-plus/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/snailium/dsh-share-plus/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/snailium/dsh-share-plus/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/snailium/dsh-share-plus/releases/tag/v0.2.0
