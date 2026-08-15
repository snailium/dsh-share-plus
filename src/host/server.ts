/**
 * The read-only share HTTP server — a SEPARATE `node:http` server bound to
 * `0.0.0.0` (the main harness stays loopback-only). It serves exactly one
 * kind of content: a pre-rendered snapshot page at `/s/<token>`. No mutation
 * surface, no RPC, no session reads — a token either resolves to its frozen
 * HTML or it 404s. Token entropy is 128 bits, so the URL is unguessable.
 */

import { createServer, type Server } from 'node:http'
import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'

export interface ShareServerHandle {
  port: number
  close(): Promise<void>
}

export interface ShareServerOptions {
  host: string
  port: number
  /** Resolve a token to its frozen HTML page, or null when unknown/expired. */
  lookup: (token: string) => Promise<string | null>
}

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
export function primaryLanIPv4(): Promise<string | undefined> {
  return new Promise((resolve) => {
    let sock: import('node:dgram').Socket | undefined
    let settled = false
    const done = (value: string | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { sock?.close() } catch { /* ignore */ }
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

function send(res: import('node:http').ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

const NOT_FOUND = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>链接不存在</title></head><body style="font-family:system-ui,sans-serif;padding:40px;color:#666"><h2>分享链接不存在或已失效</h2><p>该链接可能已被撤销、已过期，或从未存在。</p></body></html>`

export function startShareServer(options: ShareServerOptions): Promise<ShareServerHandle> {
  const server: Server = createServer(async (req, res) => {
    try {
      const rawPath = new URL(req.url ?? '/', 'http://x').pathname
      const match = /^\/s\/([A-Za-z0-9_-]+)$/.exec(rawPath)
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, 'method not allowed')
        return
      }
      if (match === null) {
        send(res, 404, NOT_FOUND, 'text/html; charset=utf-8')
        return
      }
      const html = await options.lookup(match[1])
      if (html === null) {
        send(res, 404, NOT_FOUND, 'text/html; charset=utf-8')
        return
      }
      send(res, 200, html, 'text/html; charset=utf-8')
    } catch (err) {
      send(res, 500, 'internal error')
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
        close: () => new Promise<void>((done) => {
          server.closeAllConnections()
          server.close(() => done())
        }),
      })
    })
  })
}
