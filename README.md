<div align="center">

# dsh-share-plus

**Share a DeepSeek Harness session over your LAN as a read-only, token-guarded snapshot — with secrets redacted by default.**

[📖 中文文档](./README_CN.md)

</div>

`dsh-share-plus` is a [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) plugin that adds a **Share** button to the session header. One click freezes the current conversation into a self-contained, read-only HTML page and prints a LAN URL — e.g. `http://192.168.1.20:3081/s/<token>` — that any device on the same network can open in a browser.

It also serves **read-only directory shares**: point it at a build output folder and `http://192.168.1.20:3081/apk/` becomes a browsable file listing, so an APK built inside a session can be installed straight from a phone. Directories are configured in the plugin's settings card on the Plugins page, or in `cordis.patch.yml`.

It is a fork of [`@zljr/dsh-share`](https://github.com/zljr/dsh-share) (MIT) that adds **content redaction** and **directory mounts**, so a snapshot can be handed to a colleague, pasted into an issue, or published behind a tunnel without leaking credentials, local paths, or private addresses.

The main harness keeps listening on `127.0.0.1` (and so never exposes the agent's command execution). Sharing is served by a **separate, read-only HTTP server** that returns a pre-rendered snapshot page for a valid token, or a directory listing and its files.

## What a running server exposes

| URL | What it serves |
|-----|----------------|
| `/s/<token>` | A frozen session snapshot (redacted at share time). |
| `/<mount>/` | A browsable, read-only listing of one configured directory. |
| `/<mount>/<token>/` | The same, when that mount has a token configured. |
| `/<mount>/…/file` | The file itself, with `Range`/`HEAD`/`ETag` support. |
| `/` | A landing page listing the **open** mounts only (token mounts are not advertised). |

`GET` and `HEAD` only. There is no upload, no delete, and no RPC on this port.

## Features

- 🛡️ **Redaction on by default** — API keys, cloud tokens, JWTs, private-key blocks, `KEY=value` secrets, URL credentials, home-directory paths and private IPs are replaced with `«REDACTED»` before anything is written to a snapshot. The header reports how many items were masked.
- 📁 **Directory shares** — add a local directory in the plugin's settings card and it appears at `/<name>/`, browsable and downloadable, effective immediately with no restart.
- 📱 **APK-friendly** — `.apk` is served as `application/vnd.android.package-archive` with `Content-Disposition: attachment`, so a phone offers to install rather than dumping a blob.
- 🔗 **One-click session share** — a **Share** button in the session header (beside the official "Session log" action).
- 🔒 **Read-only & isolated** — the share server binds `0.0.0.0:<port>` on its own; the main harness stays loopback-only.
- 🧊 **Frozen snapshot** — the transcript *and* session stats are captured at share time; later edits or compactions never change an already-shared page.
- 🔑 **Revocable + optional expiry** — 128-bit random tokens; stop sharing anytime, or pick a 1h / 24h / 7d expiry.
- 📖 **Readable by default** — a share shows your prompts and the final answer of each turn. Tool calls, injected context, system notices and the stats header are **off** unless you ask for them (see *Technical output*).
- 🎨 **Same look as the harness** — the page uses the harness's own font stack, neutral palette and message geometry: a right-aligned brand-tinted prompt bubble, the answer as plain full-width text, in a 680px column.
- 📝 **Markdown transcript** — messages are Markdown-rendered (safe: raw HTML is escaped, `javascript:` URLs are blocked) and **line breaks are preserved**, so a multi-line prompt reads as written.
- 🪗 **Readable** — long messages auto-fold behind a preview; consecutive tool calls collapse into one "🛠 tool calls" group.
- 📊 **Session stats header** — turns, steps, wall-clock duration, tool-call time, cache hits, input/output tokens, and current context occupancy.
- 🌗 **Dark & light theme** — the share pages follow `prefers-color-scheme`.
- 💾 **Survives restarts** — shares are stored in `$DSH_HOME/.dsh/dsh-share-plus.json`, and the server rebinds at boot while any of them is live, so an already-shared link does not go dark when dsh restarts.
- 📡 **Smart LAN address** — filters out virtual adapters (WSL / Hyper-V / Docker / VPN / …) and probes the default route so the phone-reachable IP is listed first.

## Directory shares

Open **Plugins → dsh-share-plus → Configure** and add a row per directory:

| Field | Meaning |
|-------|---------|
| `name` | URL prefix. `apk` serves at `/apk/`. Must start with a letter or digit, and may contain letters, digits, `.`, `_`, `-`. `s` is reserved for session shares. |
| `path` | Absolute path of the directory. Only this directory is exposed. |
| `token` | Optional. Empty means anyone who can reach the port may browse it. Set it and the address becomes `/<name>/<token>/…`. |
| `index` | Whether visiting a directory lists its files. Turn it off to allow only direct file URLs. |
| `hidden` | Whether files starting with `.` are served. **Off by default** — build directories routinely contain `.env`, `.gradle/`, and signing keystores. |

The card shows each mount's live state and the URL to copy; a path that does not exist (or a name that collides) is reported as **Not serving** with the reason, and the session-share server keeps working regardless.

The same thing from a config file:

```yaml
- id: dsh-share-plus
  config:
    port: 3081
    mounts:
      - name: apk
        path: /home/me/app/android/app/build/outputs/apk/release
      # Directories with anything private in them should carry a token.
      - name: logs
        path: /var/log/mydaemon
        token: change-me
        index: false
        hidden: false
```

`mounts` is the one live-editable field: saving in the card rewrites this row in the profile's `cordis.patch.yml` and the server picks it up on the next request.

### What a directory share will not do

Containment is enforced per request, and every failure is reported as `404` (never `403`) so that a denied path is indistinguishable from an absent one:

- **Traversal** — the request path is split into segments *before* percent-decoding, and a segment that decodes to `..`, or that contains a separator or NUL byte, is refused. `%2e%2e`, `%2f`, `%5c` and `%00` variants are all covered by the test suite.
- **Symlink escape** — the resolved path is re-checked against the mount's own `realpath`, so a symlink pointing outside the mount is refused. Symlinks that stay inside work normally.
- **Dotfiles** — withheld unless the mount opts in with `hidden: true`.
- **Non-regular files** — sockets, FIFOs and device nodes are refused.
- **Executable content** — HTML, SVG and XML are never served inline on this origin (the same origin also serves token-guarded session pages); they are forced to download. Unknown types are opaque bytes.

Note that a directory share is **not redacted**. Redaction applies to session snapshots; a shared build directory is published as-is. Use a token, and keep secrets out of the directory you share.

### Resource limits

Every bound is explicit and enforced independently of the transport, so nothing here depends on a Node default that may change:

| Bound | Limit | Response when exceeded |
|-------|-------|------------------------|
| Request target (URL) | 16 KiB of header bytes | `431`, refused by the HTTP parser before routing |
| Path depth | 128 segments | `414` |
| Single path segment | 255 characters (no filesystem allows more) | `414` |
| Directory listings | 5000 rows per request, scanned as a stream | The listing says it was truncated |
| RPC request body | 256 KiB, also checked against `Content-Length` first | `413` |
| Rendered session pages | 16 MiB total cache, 4 MiB per page | Older pages are evicted; oversized pages are served uncached |
| Stored shares | 100, oldest evicted | — |
| Slow requests | 10 s to headers, 30 s per request, 5 s keep-alive | Connection closed |

Two notes on what is deliberately *not* limited:

- **Download size and duration.** A large APK over slow Wi-Fi is the intended use, so there is no socket inactivity timeout; the request-side timeouts above bound how long a client may hold a connection while *sending*.
- **Snapshot size.** A transcript is not truncated — truncating a session share silently would be worse than a large page. Serving cost is instead bounded by the page cache, so a frozen snapshot is rendered once rather than per request.

## Technical output

A share is meant to be read, so the machine-facing half of a session is **off by default**. With it off you get the prompts you typed and the answer that concluded each turn — nothing else.

| | Technical output OFF (default) | Technical output ON |
|---|---|---|
| Prompts, final answer | shown | shown |
| Interim assistant messages ("let me check X…") | dropped | shown |
| Tool calls / results | dropped | shown, grouped and collapsed |
| Injected context (plugin notices, skill invocations, runtime-context snapshots) | dropped | shown |
| Session statistics header | omitted (not even computed) | shown |
| Long messages | rendered in full | folded behind 展开全文 |

Two places control it:

- **Plugins → dsh-share-plus → Configure → 输出技术信息** sets the default for new shares. It is a live setting: save and the next share uses it.
- **The share dialog** has a per-share checkbox, seeded from that default, so you can turn it on for one debugging share without changing the global setting.

From a config file:

```yaml
- id: dsh-share-plus
  config:
    port: 3082
    technicalInfo: false   # default
```

Shares created before this setting existed are treated as technical, which is what they are.

## Redaction

Redaction runs on the **host**, in the single choke point where the session event log is folded into a transcript, so every downstream surface (page body, derived page title) sees masked text only. The raw session log on disk is never modified.

### What is masked

| Class | Matches | Default |
|-------|---------|---------|
| `privateKey` | `-----BEGIN … PRIVATE KEY-----` blocks, up to the matching `END` (or end of text) | on |
| `jwt` | `eyJ…`-prefixed three-segment base64url tokens | on |
| `cloudKeys` | `sk-…`, `AKIA…`, `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`, `github_pat_…` | on |
| `urlCredentials` | `scheme://user:password@host` | on |
| `envAssignment` | `*PASSWORD*`/`*SECRET*`/`*TOKEN*`/`*API_KEY*` `= value`, plus bare `token=…` | on |
| `localPaths` | `/home/<user>/…/`, `/Users/<user>/…/`, `C:\Users\…` | on |
| `privateIps` | `10.x`, `172.16–31.x`, `192.168.x` | on |
| `emails` | `local@domain` | **off** |

Two deliberate behaviours worth knowing:

- **Path rules mask the directory prefix but keep the final segment**, so `/home/ana/work/creds.txt` becomes `«REDACTED»creds.txt`. The structure of a path is often the sensitive part; the filename keeps the transcript readable. The Windows rule masks the whole path.
- **URL credentials keep the host**: `https://user:pw@db.internal:5432/app` becomes `«REDACTED»:5432/app`.

### Best-effort, not a guarantee

Redaction is **pattern matching**. It reliably removes the shapes above and nothing else. A secret in an unexpected format, split across lines, base64-wrapped, or written in prose will pass through untouched. **Review a snapshot before publishing it.** The plugin reports the replacement count so you can tell whether the feature fired at all (`Nothing to redact` means zero matches, not "provably clean").

### Overriding per share

The dialog's **"Redact secrets (keys, local paths, etc.) before sharing"** checkbox controls an individual share. Unchecking it deliberately produces a raw snapshot — useful for debugging redaction itself.

To change the defaults, add a `redact` block to the plugin's row in `cordis.patch.yml`:

```yaml
- id: dsh-share-plus
  config:
    port: 3082
    redact:
      enabled: true
      replacement: '[masked]'
      classes:
        emails: true      # opt in to masking addresses
        privateIps: false # keep private IPs
```

A per-share override (the dialog checkbox) always wins over this base config.

### Known limitation

A turn that fails before the model responds may leave the user's prompt only in a transient inbox event, which the transcript folder does not render. Such a share can therefore show an empty (or assistant-only) transcript. Completed turns always include the user message.

With technical output **on**, an interim assistant message is dropped when a later one in the same turn exists; the alternate wording is that the readable view keeps one answer per turn by design.

## How it works

`dsh-share-plus` is a dual-face `dsh` package, like other harness plugins:

| Half | Runs in | Role |
|------|---------|------|
| Host (`src/host`) | Node (harness process) | Folds the session event log into a redacted transcript + stats, stores the frozen snapshot, and serves it (plus every directory mount) over a separate `node:http` server. Exposes a `/dsh-share-plus` RPC (`create` / `revoke` / `list` / `mounts`) and declares the settings schema. |
| Client (`src/client`) | Browser | Registers the **Share** button in `conversation.session.header.utilities` with its dialog, and the plugin's settings card in `plugins.row.config` for managing directory mounts. |

Token estimation for the context composition reuses the harness's own fixed-density heuristic (~4 chars ≈ 1 token), matching [`dsh-context`](https://github.com/bowenliang123/dsh-context).

The `/dsh-share-plus` channel is registered directly on the injected web server rather than through `ctx.connection.rpc.handle()`. See the header comment in `src/host/rpc.ts` for why: on the current dsh/cordis composition the generic registry resolves the wrong context when it registers its route, so the entry fails to activate. The channel applies the Connection service's own trusted-Host/browser-auth fence and speaks the same wire envelope, so it is exactly as protected as a native channel.

## Install

### From npm

```sh
dsh plugin --profile web add dsh-share-plus
dsh --profile web
```

That's it — the published package ships the built `lib/`, so end users never need a build step.

### From source (local development)

```sh
# 1. Build the package artifacts (lib/)
pnpm install
pnpm build

# 2. Install into the web profile (local path)
dsh plugin --profile web add /absolute/path/to/dsh-share-plus

# 3. Restart the web UI
dsh --profile web
```

Open any session and click **Share** in the header.

### Upgrading from a `dsh-share` install

0.4.0 renamed the loader row, the settings namespace, the RPC channel and the
store file to `dsh-share-plus`. Two things must be renamed by hand, because the
namespace IS the row id and the store filename is not migrated automatically:

```bash
# 1. the profile's patch layer
sed -i 's/^- id: dsh-share$/ - id: dsh-share-plus/' ~/.dsh/profiles/<name>/cordis.patch.yml

# 2. the snapshot store (keeps existing shares alive)
mv ~/.dsh/.dsh/dsh-share.json ~/.dsh/.dsh/dsh-share-plus.json
```

Skipping step 1 loses the row's configuration (its `publicDomain`, `mounts`,
`port`); skipping step 2 makes every existing share 404.

### Compatibility

The plugin's contract with the harness is the **session record format**, not a
harness version. It renders four event types out of the format-4 vocabulary
(`user/message`, `assistant/message`, `tool/result`, `tool/call`) and reads the
session store through `ctx.sessionQuery`; everything else it either ignores
deliberately or never touches. The manifest declares this as
`dsh.sessionFormat: 4`.

A session written by a newer format is not a crash: unknown event types are
skipped, and the share page says so ("此分享的部分内容使用了较新的会话格式")
instead of quietly showing a short conversation.

A harness release may add event types without bumping the format version, so
the plugin recognises the **union** of every vocabulary it has supported
(`tests/vocabulary.test.mjs` pins them). Supported harness generations:
`0.2.0-rc.2` (59 event types) and `0.2.1-rc.2` (62), both format v4.

### Public links

By default every generated link is a LAN address (`http://<ip>:<port>/...`). When you want the link to work from the internet — say, for a phone that is not on your network — set **绑定域名 / Public domain** in the settings card (or `publicDomain` in config) to a hostname that points at this machine, e.g. `share.example.com`. Generated links then lead with `https://share.example.com/s/<token>`; the LAN addresses stay in the list as fallbacks for local devices.

Existing shares pick the domain up immediately as well: the store keeps only the token, never a URL, so every link is re-derived from the current domain and bound port each time it is read — no migration, no restart needed when you fill in (or change) the domain.

The plugin only *names* the domain — it does not open any port or install any certificate. You still have to make the hostname reach the server, e.g.:

- **Cloudflare Tunnel** (or Caddy `reverse_proxy`): forward `share.example.com/*` → `http://127.0.0.1:3082`.
- **frp / nps / tailscale funnel**: same idea — public hostname in, local port out.

The share pages use only relative resources, so any path prefix the proxy adds works unchanged.

The share server binds at boot as soon as there is **anything to serve** — a share from a previous run, or a configured directory mount — so links you have already handed out keep working across a dsh restart. With nothing to serve it stays unbound, and the first share (or the settings card) starts it.

## Configuration

The plugin row is `dsh-share-plus`. It reads a config object from `cordis.patch.yml` (or the profile layer), falling back to environment variables:

| Setting | Env fallback | Default | Description |
|---------|--------------|---------|-------------|
| `host` | `DSH_SHARE_HOST` | `0.0.0.0` | Bind address of the read-only share server. |
| `port` | `DSH_SHARE_PORT` | `3081` | Port of the share server. |
| `redact.enabled` | — | `true` | Master switch for redaction. |
| `redact.classes` | — | see table | Per-class on/off toggles. |
| `redact.replacement` | — | `«REDACTED»` | Replacement text. |
| `technicalInfo` | — | `false` | Include tool calls, injected context, system notices and stats in shares. Editable live from the settings card. |
| `publicDomain` | — | `''` | Optional public hostname. When set, generated links use `https://<domain>/...` instead of LAN addresses (for a reverse proxy or tunnel that forwards it to this server). Editable live from the settings card. |
| `mounts` | — | `[]` | Read-only directory shares (see above). Editable live from the settings card. |

Precedence is **config > environment variable > default**. `host` and `port` are configuration-file settings only: the server binds them once, so they are deliberately not offered in the settings card.

> On Windows, the first `0.0.0.0` listen may trigger a firewall prompt — allow it so other devices can reach the link.

## Security model

- The **main harness stays loopback-only**; only the read-only share surface is reachable from the LAN.
- Share tokens are **128-bit random** (unguessable) and can be **revoked** or set to **expire**.
- The `/dsh-share-plus` RPC channel sits behind the harness's trusted-Host/Origin fence and browser authentication; unauthenticated callers get `401`.
- Directory mounts are **read-only and containment-checked per request** (traversal, symlink escape, dotfiles, non-regular files). A denial is always reported as `404`.
- A directory mount is **open to anyone who can reach the port** unless you set a token on it. With the default `0.0.0.0` bind, that means the whole LAN; behind a tunnel, the whole internet. Set a token for anything you would not post publicly.
- Directory content is **not redacted** — only session snapshots are.
- The share page contains **no JavaScript** and **no external assets**; message text is Markdown-rendered with raw HTML escaped and dangerous URLs rejected.
- Snapshots are **redacted by default, but best-effort** — review before publishing (see above).
- The snapshot is **frozen** — it is not a live view of the session, and it is never re-read from the session store after creation.

## Development

```sh
pnpm install     # dev dependencies (typescript, esbuild, react, jsdom, …)
pnpm build       # bundle host (lib/index.js) + client (lib/client.js)
pnpm test        # typecheck + host/client functional tests
pnpm typecheck   # tsc --noEmit only
```

`tests/host.test.mjs` mounts the plugin on a fake context that mirrors the real service contract, serves the channel over a real HTTP socket, and asserts that every synthetic secret class is absent from the rendered snapshot. `tests/mounts.test.mjs` does the same for directory mounts, including the traversal, symlink-escape and dotfile refusals. `tests/client.test.mjs` renders both client components against real React in jsdom and pins the settings-card slot key and the types of the values it stages.

### Project structure

```
src/
  shared/          # wire contract shared by both halves (type-only)
  host/
    index.ts       # /dsh-share-plus channel, Config schema, share-server lifecycle
    rpc.ts         # channel route registration + wire envelope
    redact.ts      # ordered, per-class secret redaction
    mounts.ts      # directory mounts: name/path validation + containment
    listing.ts     # directory listing and landing pages
    mime.ts        # content types (incl. APK) and inline/download policy
    server.ts      # read-only HTTP server + LAN address selection
    store.ts       # token → snapshot registry (persisted JSON)
    transcript.ts  # event log → human transcript (redaction choke point)
    stats.ts       # event log → session statistics
    pricing.ts     # token estimation heuristic
    markdown.ts    # safe Markdown rendering
    html.ts        # snapshot page rendering
  client/
    index.ts       # header button + settings card registration
    components/    # ShareButton + dialog, MountsCard
    i18n.ts        # zh/en dictionaries
scripts/build.mjs  # esbuild build (host ESM + client __ModuleLoader__ bundle)
tests/             # host/client functional tests (jsdom + real React)
```

## Publishing

```sh
npm login --registry=https://registry.npmjs.org
npm publish --registry=https://registry.npmjs.org
```

The `prepublishOnly` script rebuilds `lib/` before every publish, so the tarball always carries a fresh host + client bundle.

## Acknowledgements

Forked from [`zljr/dsh-share`](https://github.com/zljr/dsh-share) by zljr, MIT licensed. The share server, storage, transcript folding, stats, Markdown rendering and snapshot page are upstream work; redaction, the redaction UI, and the direct channel registration are additions in this fork.

## Display metadata

The package ships `locale/en.json` and `locale/zh.json` with a `meta` object
(`title`, `description`). The harness reads `locale/en.json` as the anchor and
resolves each file through the package's `"./locale/*.json"` export, so the
Plugins page shows a translated title and description instead of the raw
package name.

## License

[MIT](./LICENSE)
