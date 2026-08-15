/**
 * dsh-share — Host half (installed package entry).
 *
 * A plain Cordis plugin module (ESM, zero runtime dependencies) loaded by the
 * harness as the `dsh-share` loader row. It owns:
 *   - a `/dsh-share` Connection RPC channel (create / revoke / list), and
 *   - a separate read-only `node:http` server bound to `0.0.0.0` that serves
 *     frozen transcript snapshots at `/s/<token>`.
 *
 * The main harness stays loopback-only; only the read-only share surface is
 * reachable from the LAN, guarded by 128-bit random tokens.
 */

import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CreateResult, ListResult, ShareInfo } from '../shared/types'
import type { RpcResult, SessionQueryLike } from './services'
import { foldTranscript, deriveTitle } from './transcript'
import { computeStats } from './stats'
import { renderShareHtml } from './html'
import { ShareStore, type ShareEntry } from './store'
import { lanIPv4s, primaryLanIPv4, startShareServer, type ShareServerHandle } from './server'

export const name = 'dsh-share'

/** Required services: the generic Connection RPC registry (host half). */
export const inject = ['connection']

export interface ShareConfig {
  host?: string
  port?: number
}

export function apply(ctx: Context, config?: ShareConfig): void {
  const host = config?.host ?? process.env.DSH_SHARE_HOST ?? '0.0.0.0'
  const port = config?.port ?? (process.env.DSH_SHARE_PORT !== undefined ? Number(process.env.DSH_SHARE_PORT) : 3081)

  const store = new ShareStore()
  let serverHandle: ShareServerHandle | null = null
  let serverPromise: Promise<number> | null = null

  const ensureServer = async (): Promise<number> => {
    if (serverHandle !== null) return serverHandle.port
    if (serverPromise !== null) return serverPromise
    serverPromise = startShareServer({
      host,
      port,
      lookup: async (token) => {
        const entry = await store.get(token)
        if (entry === undefined) return null
        return renderShareHtml({
          title: entry.title,
          createdAt: entry.createdAt,
          ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
          entries: entry.entries,
          ...(entry.stats !== undefined ? { stats: entry.stats } : {}),
        })
      },
    }).then((handle) => {
      serverHandle = handle
      return handle.port
    }).finally(() => {
      serverPromise = null
    })
    return serverPromise
  }

  const buildShareInfo = async (entry: ShareEntry, boundPort: number): Promise<ShareInfo> => {
    // Primary first: the default-route address a phone on the same LAN can
    // actually reach. The rest are the remaining REAL adapters (virtual
    // adapters and link-local already filtered out by lanIPv4s).
    const primary = await primaryLanIPv4()
    const others = lanIPv4s().filter((ip) => ip !== primary)
    const ips = [...(primary !== undefined ? [primary] : []), ...others]
    if (ips.length === 0) ips.push('127.0.0.1')
    const urls = ips.map((ip) => `http://${ip}:${boundPort}/s/${entry.token}`)
    return {
      token: entry.token,
      sessionId: entry.sessionId,
      title: entry.title,
      createdAt: entry.createdAt,
      ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
      url: urls[0],
      urls,
    }
  }

  ctx.effect(() => {
    return ctx.connection.rpc.handle(
      '/dsh-share',
      async (endpoint: string, payload: unknown): Promise<RpcResult<unknown>> => {
        try {
          switch (endpoint) {
            case 'create': {
              const p = (payload ?? {}) as { sessionId?: unknown; expiresInSec?: unknown }
              const sessionId = typeof p.sessionId === 'string' && p.sessionId !== '' ? p.sessionId : ''
              if (sessionId === '') {
                return { ok: false, error: { code: 'internal', message: 'missing sessionId' } }
              }
              const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike | undefined
              if (sessionQuery === undefined) {
                return { ok: false, error: { code: 'internal', message: 'sessionQuery is unavailable' } }
              }
              const read = await sessionQuery.readSession(sessionId)
              const entries = foldTranscript(read.events)
              const stats = computeStats(read.events)
              const expiresInSec = typeof p.expiresInSec === 'number' && p.expiresInSec > 0 ? p.expiresInSec : undefined
              const entry: ShareEntry = {
                token: randomBytes(16).toString('hex'),
                sessionId,
                title: deriveTitle(entries, sessionId),
                createdAt: Date.now(),
                ...(expiresInSec !== undefined ? { expiresAt: Date.now() + expiresInSec * 1000 } : {}),
                entries,
                stats,
              }
              await store.add(entry)
              const boundPort = await ensureServer()
              const value: CreateResult = { share: await buildShareInfo(entry, boundPort) }
              return { ok: true, value }
            }
            case 'revoke': {
              const p = (payload ?? {}) as { token?: unknown }
              const token = typeof p.token === 'string' && p.token !== '' ? p.token : ''
              if (token === '') return { ok: false, error: { code: 'internal', message: 'missing token' } }
              const removed = await store.remove(token)
              return { ok: true, value: { removed } }
            }
            case 'list': {
              const entries = await store.list()
              const boundPort = serverHandle?.port ?? port
              const shares = await Promise.all(entries.map((e) => buildShareInfo(e, boundPort)))
              const value: ListResult = { shares }
              return { ok: true, value }
            }
            default:
              return { ok: false, error: { code: 'internal', message: `unknown endpoint: ${endpoint}` } }
          }
        } catch (err) {
          return {
            ok: false,
            error: {
              code: 'internal',
              message: err instanceof Error ? err.message : String(err),
            },
          }
        }
      },
      { authority: 'trusted-host' },
    )
  }, 'dsh-share: rpc channel')

  // Dispose: close the share server (registered listeners dropped via the
  // effect above). Starting lazily means no 0.0.0.0 listener until a share is
  // first created.
  ctx.effect(() => () => {
    void serverHandle?.close()
  }, 'dsh-share: share server lifecycle')
}

// ---- public type surface (stable for downstream consumers) -------------------

export type { ShareInfo, TranscriptEntry } from '../shared/types'
