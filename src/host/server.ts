/**
 * The read-only share HTTP server — a SEPARATE `node:http` server bound to
 * `0.0.0.0` (the main harness stays loopback-only). It serves two kinds of
 * content and mutates nothing:
 *
 *   - `GET /s/<token>` — a frozen, pre-rendered session snapshot. A token
 *     either resolves to its HTML or the request 404s. 128-bit tokens make the
 *     URL unguessable.
 *   - `GET /<mount>/…` — a read-only view of one configured directory, with an
 *     optional `<token>` segment. Containment (traversal, symlink escape,
 *     dotfiles) is enforced in `mounts.ts`.
 *
 * The server accepts `GET` and `HEAD` only. There is no upload, no delete, and
 * no RPC surface here.
 */

import { createReadStream } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { contentTypeOf, isInlineType } from './mime'
import { lookupInMount, resolveMounts, type Mount, type ResolvedMounts } from './mounts'
import { RenderedPageCache } from './cache'
import { escapeHtml, mountBasePath, PAGE_CSP, readListing, renderListing, renderMountIndex } from './listing'

export interface ShareServerHandle {
  port: number
  close(): Promise<void>
  /** Drop a cached page (called when its share is revoked). */
  forget(token: string): void
  /** Drop cached pages whose share is no longer in the store. */
  keepOnly(tokens: ReadonlySet<string>): void
}

export interface SharePage {
  html: string
  /** Share expiry (ms epoch); the cache drops the page rather than outlive it. */
  expiresAt?: number
}

export interface ShareServerOptions {
  host: string
  port: number
  /** Resolve a token to its frozen page, or null when unknown/expired. */
  lookup: (token: string) => Promise<SharePage | null>
  /**
   * Current directory mounts. Called per request so a live configuration edit
   * takes effect without restarting the server. Omitted = no directory mode.
   */
  getMounts?: () => Promise<ResolvedMounts>
}

/**
 * Transport limits, stated explicitly rather than inherited from Node's
 * defaults (which have changed across releases).
 *
 * `maxHeaderSize` covers the request line, so an over-long URL is refused by
 * the parser with 431 before it can reach any routing code. The application
 * additionally caps path depth and segment length in `mounts.ts`, so the two
 * bounds are independent.
 *
 * `requestTimeout`/`headersTimeout` bound how long a client may hold a
 * connection while dribbling out a request (slowloris). They are deliberately
 * NOT accompanied by a socket inactivity timeout: large file DOWNLOADS are
 * responses, and killing a slow download on a weak Wi-Fi link would be worse
 * than the risk being mitigated here.
 */
const MAX_HEADER_BYTES = 16 * 1024
const HEADERS_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 30_000
const KEEP_ALIVE_TIMEOUT_MS = 5_000

/** Rendered-page cache budget: enough for many pages, bounded regardless of transcript size. */
const PAGE_CACHE_BYTES = 16 * 1024 * 1024
const PAGE_CACHE_MAX_PAGE = 4 * 1024 * 1024

/** Substrings that identify virtual (non-physical) adapters, matched case-insensitively. */
const VIRTUAL_HINTS = [
  'vEthernet', 'Hyper-V', 'WSL', 'VirtualBox', 'VMware', 'VMnet', 'vbox',
  'Docker', 'Tailscale', 'ZeroTier', 'Teredo', 'isatap', 'Loopback',
  'utun', 'WireGuard', 'NordLynx', 'TAP-', 'tap',
]

function isVirtualName(name: string): boolean {
  const n = name.toLowerCase()
  return VIRTUAL_HINTS.some((hint) => n.includes(hint.toLowerCase()))
}

function isLinkLocal(ip: string): boolean {
  return ip.startsWith('169.254.')
}

/**
 * Real LAN IPv4 addresses: non-internal, non-link-local, and excluding
 * virtual adapters (WSL / Hyper-V / Docker / VPNs / …). Virtual adapters are
 * not reachable from another phone on the same Wi-Fi, so listing them only
 * produces dead links.
 */
export function lanIPv4s(): string[] {
  const out: string[] = []
  for (const [name, ifaces] of Object.entries(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface === undefined || iface.family !== 'IPv4' || iface.internal) continue
      if (isLinkLocal(iface.address)) continue
      if (isVirtualName(name)) continue
      out.push(iface.address)
    }
  }
  return out
}

/**
 * The primary LAN IPv4 via the UDP route-probe trick: connect a UDP socket to
 * a public IP literal (no packet is sent) and read back the local address the
 * OS chose for that route. This is the interface a phone on the same LAN can
 * actually reach — usually the default-route (Wi-Fi/Ethernet) adapter.
 *
 * Async + bounded: uses the connect callback (the synchronous form is not
 * guaranteed to have bound yet on all platforms), and always closes the socket
 * and settles — even on error — so a failed probe can never hang a share or
 * leak a UDP handle. Resolves undefined when no route can be determined.
 */
let cachedLanIp: { ip: string | undefined; expiresAt: number } | undefined

export function primaryLanIPv4(): Promise<string | undefined> {
  const now = Date.now()
  if (cachedLanIp !== undefined && cachedLanIp.expiresAt > now) {
    return Promise.resolve(cachedLanIp.ip)
  }

  return new Promise((resolve) => {
    let sock: import('node:dgram').Socket | undefined
    let settled = false
    const done = (value: string | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { sock?.close() } catch { /* ignore */ }
      // Cache for 30s so offline/isolated networks don't re-wait 1.5s on every share/status call
      cachedLanIp = { ip: value, expiresAt: Date.now() + 30_000 }
      resolve(value)
    }
    const timer = setTimeout(() => done(undefined), 1500)
    try {
      sock = createSocket('udp4')
      sock.once('error', () => done(undefined))
      sock.connect(80, '1.1.1.1', () => {
        try {
          const addr = sock?.address()
          const ip = typeof addr === 'object' && addr !== null ? addr.address : undefined
          if (typeof ip === 'string' && ip !== '' && ip !== '127.0.0.1' && !isLinkLocal(ip)) done(ip)
          else done(undefined)
        } catch {
          done(undefined)
        }
      })
    } catch {
      done(undefined)
    }
  })
}

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

function sendHtml(res: ServerResponse, status: number, body: string, headOnly = false): void {
  res.writeHead(status, {
    ...BASE_HEADERS,
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'content-security-policy': PAGE_CSP,
  })
  res.end(headOnly ? undefined : body)
}

function notFound(res: ServerResponse): void {
  sendHtml(
    res,
    404,
    `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>链接不存在</title></head><body style="font-family:system-ui,sans-serif;padding:40px;color:#666"><h2>内容不存在</h2><p>该链接可能已被撤销、已过期，或从未存在。</p></body></html>`,
  )
}

function uriTooLong(res: ServerResponse): void {
  res.writeHead(414, { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
  res.end('uri too long')
}

/** RFC 5987 / 6266 disposition header that survives non-ASCII filenames. */
function contentDisposition(basename: string, inline: boolean): string {
  const ascii = basename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(basename)
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/** Parse a single `bytes=` range against a known size. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (header === undefined || header === '') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null // multi-range or non-bytes: fall back to a full response
  const rawStart = match[1] ?? ''
  const rawEnd = match[2] ?? ''
  if (rawStart === '' && rawEnd === '') return 'invalid'

  let start: number
  let end: number
  if (rawStart === '') {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid'
  if (start > end || start >= size) return 'invalid'
  return { start, end: Math.min(end, size - 1) }
}

/** Serve one regular file, honouring HEAD, validators and single byte ranges. */
function respondFile(
  req: IncomingMessage,
  res: ServerResponse,
  mount: Mount,
  file: { absolute: string; basename: string; size: number; mtimeMs: number },
): void {
  const headOnly = req.method === 'HEAD'
  const contentType = contentTypeOf(file.basename)
  const inline = isInlineType(contentType)
  const etag = `W/"${file.size}-${Math.round(file.mtimeMs)}"`
  const lastModified = new Date(file.mtimeMs).toUTCString()

  const validators = { etag, 'last-modified': lastModified }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, validators)
    res.end()
    return
  }

  const range = parseRange(req.headers.range, file.size)
  if (range === 'invalid') {
    res.writeHead(416, { ...validators, 'content-range': `bytes */${file.size}` })
    res.end()
    return
  }

  const headers: Record<string, string | number> = {
    ...BASE_HEADERS,
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'content-disposition': contentDisposition(file.basename, inline),
    ...validators,
  }

  if (range !== null) {
    headers['content-range'] = `bytes ${range.start}-${range.end}/${file.size}`
    headers['content-length'] = range.end - range.start + 1
    res.writeHead(206, headers)
    if (headOnly) {
      res.end()
      return
    }
    const stream = createReadStream(file.absolute, { start: range.start, end: range.end })
    stream.on('error', () => res.destroy())
    stream.pipe(res)
    return
  }

  headers['content-length'] = file.size
  res.writeHead(200, headers)
  if (headOnly) {
    res.end()
    return
  }
  const stream = createReadStream(file.absolute)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

/** Route a request for `/<mount>/…` after the mount name has been matched. */
async function serveMount(
  req: IncomingMessage,
  res: ServerResponse,
  mount: Mount,
  subPath: string,
): Promise<void> {
  const found = await lookupInMount(mount, subPath)

  if (found.kind === 'too-long') {
    uriTooLong(res)
    return
  }

  if (found.kind === 'missing' || found.kind === 'denied') {
    // Denials are reported as 404 on purpose: distinguishing "denied" from
    // "absent" would confirm the existence of hidden and escaping paths.
    notFound(res)
    return
  }

  if (found.kind === 'dir') {
    if (!mount.index) {
      notFound(res)
      return
    }
    const listing = await readListing(mount, found.absolute)
    sendHtml(res, 200, renderListing(mount, found.segments, listing), req.method === 'HEAD')
    return
  }

  respondFile(req, res, mount, found)
}

export function startShareServer(options: ShareServerOptions): Promise<ShareServerHandle> {
  // Rendered pages are cached because a share is frozen: the same token always
  // yields the same bytes, so re-rendering per request is pure amplification.
  const pages = new RenderedPageCache({ maxBytes: PAGE_CACHE_BYTES, maxPageBytes: PAGE_CACHE_MAX_PAGE })

  const server: Server = createServer({
    maxHeaderSize: MAX_HEADER_BYTES,
    headersTimeout: HEADERS_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
  }, async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }

      const pathname = new URL(req.url ?? '/', 'http://x').pathname

      // -- session snapshots: /s/<token> --
      const share = /^\/s\/([A-Za-z0-9_-]+)$/.exec(pathname)
      if (share !== null) {
        const token = share[1]!
        const now = Date.now()
        // The cache re-checks the share's expiry, so a cached page can never
        // outlive it; a revoked share is dropped by the host on `revoke`.
        let html = pages.get(token, now)
        if (html === undefined) {
          const page = await options.lookup(token)
          if (page === null) {
            notFound(res)
            return
          }
          pages.set(token, { html: page.html, ...(page.expiresAt !== undefined ? { expiresAt: page.expiresAt } : {}) })
          html = page.html
        }
        sendHtml(res, 200, html, req.method === 'HEAD')
        return
      }

      // -- directory mounts --
      if (options.getMounts === undefined) {
        if (pathname === '/' || pathname === '') {
          sendHtml(res, 200, renderMountIndex([]), req.method === 'HEAD')
          return
        }
        notFound(res)
        return
      }

      if (pathname === '/' || pathname === '') {
        const { mounts } = await options.getMounts()
        sendHtml(res, 200, renderMountIndex(mounts), req.method === 'HEAD')
        return
      }

      const rawSegments = pathname.split('/').slice(1)
      const firstRaw = rawSegments[0] ?? ''
      let firstName: string
      try {
        firstName = decodeURIComponent(firstRaw)
      } catch {
        notFound(res)
        return
      }

      const { mounts } = await options.getMounts()
      const mount = mounts.find((m) => m.name === firstName)
      if (mount === undefined) {
        notFound(res)
        return
      }

      let rest = rawSegments.slice(1)
      if (mount.token !== undefined) {
        const tokenRaw = rest[0]
        let tokenValue: string | undefined
        try {
          tokenValue = tokenRaw === undefined ? undefined : decodeURIComponent(tokenRaw)
        } catch {
          tokenValue = undefined
        }
        if (tokenValue !== mount.token) {
          // No distinction between "wrong token" and "no such mount".
          notFound(res)
          return
        }
        rest = rest.slice(1)
      }

      await serveMount(req, res, mount, `/${rest.join('/')}`)
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
      }
      res.end('internal error')
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      server.on('error', () => { /* ignore post-listen socket errors */ })
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : options.port
      resolve({
        port,
        forget: (token: string) => pages.delete(token),
        keepOnly: (tokens: ReadonlySet<string>) => pages.prune(tokens),
        close: () => new Promise<void>((done) => {
          pages.clear()
          server.closeAllConnections()
          server.close(() => done())
        }),
      })
    })
  })
}

/** Re-exported so the host entry can validate specs without importing mounts directly. */
export { resolveMounts, type Mount, type ResolvedMounts }
export { escapeHtml }
