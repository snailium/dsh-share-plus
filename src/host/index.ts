/**
 * dsh-share-plus — Host half (installed package entry).
 *
 * A plain Cordis plugin module (ESM, zero runtime dependencies) loaded by the
 * harness as the `dsh-share-plus` loader row. It owns:
 *   - a `/dsh-share-plus` Connection RPC channel (create / revoke / list), and
 *   - a separate read-only `node:http` server bound to `0.0.0.0` that serves
 *     frozen transcript snapshots at `/s/<token>`.
 *
 * The main harness stays loopback-only; only the read-only share surface is
 * reachable from the LAN, guarded by 128-bit random tokens.
 */

import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CreateResult, DefaultsResult, ListResult, MountView, MountsResult, ShareInfo } from '../shared/types'
import type { SessionQueryLike } from './services'
import { registerRpcChannel, type RpcResult } from './rpc'
import { foldTranscript, deriveTitle } from './transcript'
import { redactText, type RedactClass, type RedactOptions } from './redact'
import { computeStats } from './stats'
import { renderShareHtml } from './html'
import { ShareStore, type ShareEntry } from './store'
import { lanIPv4s, primaryLanIPv4, startShareServer, type ShareServerHandle } from './server'
import { resolveMounts, type MountSpec, type ResolvedMounts } from './mounts'

export const name = 'dsh-share-plus'

/**
 * Required services. `connection` supplies the request admission fence
 * (trusted Host/Origin + browser authentication) and `webServer` hosts the
 * plugin's `/dsh-share-plus` channel route; both are hard dependencies because this
 * is a web-only plugin. See `./rpc.ts` for why the route is registered here
 * rather than through `connection.rpc.handle()`.
 */
export const inject = ['connection', 'webServer']

export interface RedactConfig {
  /** Master switch. Default ON — snapshots are redacted unless explicitly disabled. */
  enabled?: boolean
  /** Per-class toggles (e.g. keep emails). A `true` here enables that class. */
  classes?: Partial<Record<RedactClass, boolean>>
  /** Replacement text. Default '«REDACTED»'. */
  replacement?: string
}

export interface ShareConfig {
  host?: string
  port?: number
  redact?: RedactConfig
  /**
   * Include machine-facing output (tool calls/results, injected context,
   * system notices, every interim assistant message, and the stats header).
   * Default FALSE: a share shows the user's prompts and the final answer of
   * each turn, which is what makes it readable.
   */
  technicalInfo?: boolean
  publicDomain?: string
  /** Read-only directory shares, each mounted at `/<name>/`. */
  mounts?: MountSpec[]
}

/**
 * Settings schema.
 *
 * `mounts` is the one `.volatile()` field, which is what makes this entry a
 * settings namespace at all (the Plugins page skips entries without a volatile
 * field). Volatility is declared on the outermost array only: schemastery
 * refuses a volatile field nested inside another, and an array of plain
 * objects is the shape the settings card stages and writes back wholesale.
 *
 * `host` and `port` are deliberately NOT volatile — the share server binds them
 * once and there is no live rebind, so offering them in the GUI would promise
 * something the plugin does not do. They stay configuration-file settings.
 */
export const Config = z.object({
  host: z.string().default('0.0.0.0').description('Bind address of the read-only share server.'),
  port: z.number().default(3081).description('Port of the read-only share server.'),
  redact: z
    .object({
      enabled: z.boolean().default(true).description('Redact secrets in session snapshots.'),
      replacement: z.string().default('«REDACTED»').description('Text substituted for redacted values.'),
      classes: z.dict(z.boolean()).default({}).description('Per-class redaction toggles.'),
    })
    .default({ enabled: true, replacement: '«REDACTED»', classes: {} })
    .description('Best-effort redaction of session snapshots.'),
  technicalInfo: z
    .boolean()
    .default(false)
    .description('Include tool calls, injected context, system notices and session statistics in shares.')
    .volatile(),
  publicDomain: z
    .string()
    .default('')
    .description('Optional public hostname (e.g. share.example.com). When set, generated URLs use https://<domain>/... instead of LAN addresses, for a reverse proxy or tunnel that forwards it to this server.')
    .volatile(),
  mounts: z
    .array(
      z.object({
        name: z.string().default('').description('URL prefix, e.g. "apk" for /apk/.'),
        path: z.string().default('').description('Absolute path of the directory to share, read-only.'),
        token: z.string().default('').description('Optional shared secret; when set the URL becomes /<name>/<token>/.'),
        index: z.boolean().default(true).description('Render a browsable directory listing.'),
        hidden: z.boolean().default(false).description('Serve dotfiles. Off by default — they often hold credentials.'),
      }),
    )
    .default([])
    .description('Read-only directory shares, each mounted at /<name>/.')
    .volatile(),
})

/**
 * Read a config value that may be a volatile handle.
 *
 * Under a schemastery-volatile field the resolved value is a live reference
 * with a `get()`, not the value itself. The prototype check keeps this from
 * misfiring on an ordinary map-shaped config object.
 */
function readVolatile<T>(value: T | { get(): T } | undefined): T | undefined {
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    typeof (value as { get?: unknown }).get === 'function'
  ) {
    return (value as { get(): T }).get()
  }
  return value as T | undefined
}

/**
 * Resolve whether a share includes technical output: the per-share choice wins,
 * then the configured default, then OFF. Off is the default on purpose — an
 * agentic transcript is mostly tool chatter, and a reader wants the exchange.
 */
function resolveTechnical(base: boolean | undefined, override: boolean | undefined): boolean {
  return override ?? base ?? false
}

/** Resolve the per-create redact options: patch-layer config is the default, a per-create override wins. */
function resolveRedact(base?: RedactConfig, override?: RedactConfig): RedactOptions {
  const enabled = override?.enabled ?? base?.enabled ?? true
  return {
    enabled,
    classes: { ...(base?.classes ?? {}), ...(override?.classes ?? {}) },
    replacement: override?.replacement ?? base?.replacement,
  }
}


export function apply(ctx: Context, config?: ShareConfig): void {
  const host = config?.host ?? process.env.DSH_SHARE_HOST ?? '0.0.0.0'
  const port = config?.port ?? (process.env.DSH_SHARE_PORT !== undefined ? Number(process.env.DSH_SHARE_PORT) : 3081)

  const store = new ShareStore()
  let serverHandle: ShareServerHandle | null = null
  let serverPromise: Promise<number> | null = null

  // Read the mount list through the volatile handle on every access, so a live
  // settings edit is picked up without restarting the server or the plugin.
  const mountSpecs = (): MountSpec[] => readVolatile(config?.mounts) ?? []
  const configuredTechnical = (): boolean => readVolatile(config?.technicalInfo) === true

  /** The public hostname the user typed, normalised to a bare host. Empty means "no public domain". */
  const publicDomain = (): string => {
    const raw = (readVolatile(config?.publicDomain) ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.+$/, '')
    return raw
  }
  const resolveCurrentMounts = async (): Promise<ResolvedMounts> => await resolveMounts(mountSpecs())

  const ensureServer = async (): Promise<number> => {
    if (serverHandle !== null) return serverHandle.port
    if (serverPromise !== null) return serverPromise
    serverPromise = startShareServer({
      host,
      port,
      lookup: async (token) => {
        const entry = await store.get(token)
        if (entry === undefined) return null
        const html = renderShareHtml({
          title: entry.title,
          createdAt: entry.createdAt,
          ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
          entries: entry.entries,
          technical: entry.technical !== false,
          ...(entry.stats !== undefined ? { stats: entry.stats } : {}),
          ...(entry.redactedCount !== undefined ? { redactedCount: entry.redactedCount } : {}),
          ...(entry.unsupportedEvents !== undefined ? { unsupportedEvents: entry.unsupportedEvents } : {}),
        })
        return { html, ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}) }
      },
      getMounts: resolveCurrentMounts,
    }).then((handle) => {
      serverHandle = handle
      return handle.port
    }).finally(() => {
      serverPromise = null
    })
    return serverPromise
  }

  /** LAN addresses in preference order, loopback as the last resort. */
  const reachableIps = async (): Promise<string[]> => {
    const primary = await primaryLanIPv4()
    const others = lanIPv4s().filter((ip) => ip !== primary)
    const ips = [...(primary !== undefined ? [primary] : []), ...others]
    if (ips.length === 0) ips.push('127.0.0.1')
    return ips
  }

  /** One URL per reachable address for a mount, including its token segment. A configured public domain leads the list; the LAN addresses stay as fallbacks. */
  const mountUrls = (name: string, token: string | undefined, boundPort: number, ips: readonly string[]): string[] => {
    const path = token === undefined ? `/${name}/` : `/${name}/${token}/`
    const lan = ips.map((ip) => `http://${ip}:${boundPort}${path}`)
    const domain = publicDomain()
    return domain === '' ? lan : [`https://${domain}${path}`, ...lan]
  }

  const buildMounts = async (boundPort: number): Promise<MountsResult> => {
    const { mounts, problems } = await resolveCurrentMounts()
    const specs = mountSpecs()
    const ips = await reachableIps()
    const byName = new Map(mounts.map((m) => [m.name, m]))
    const problemByName = new Map(problems.map((p) => [p.name, p.reason]))

    const views: MountView[] = []
    const seen = new Set<string>()
    for (const spec of specs) {
      const name = typeof spec.name === 'string' ? spec.name : ''
      if (seen.has(name)) continue
      seen.add(name)
      const live = byName.get(name)
      const reason = problemByName.get(name)
      views.push({
        name,
        path: typeof spec.path === 'string' ? spec.path : '',
        root: live?.root ?? null,
        token: live?.token !== undefined,
        index: spec.index !== false,
        hidden: spec.hidden === true,
        status: live === undefined ? 'invalid' : 'serving',
        ...(live === undefined && reason !== undefined ? { reason } : {}),
        urls: live === undefined ? [] : mountUrls(live.name, live.token, boundPort, ips),
      })
    }
    const domain = publicDomain()
  return { mounts: views, lanIps: ips, ...(domain === '' ? {} : { publicDomain: domain }) }
  }

  const buildShareInfo = async (entry: ShareEntry, boundPort: number): Promise<ShareInfo> => {
    // Derived at read time — the store keeps only the token, never a URL, so an
    // existing share always reflects the CURRENT domain and bound port.
    // Primary first: the default-route address a phone on the same LAN can
    // actually reach. The rest are the remaining REAL adapters (virtual
    // adapters and link-local already filtered out by lanIPv4s).
    const ips = await reachableIps()
    const lan = ips.map((ip) => `http://${ip}:${boundPort}/s/${entry.token}`)
    // A configured public domain is the primary URL — it is what a phone on
    // the internet can actually reach. The LAN addresses stay in the list as
    // fallbacks for devices on the same network.
    const domain = publicDomain()
    const urls = domain === '' ? lan : [`https://${domain}/s/${entry.token}`, ...lan]
    return {
      token: entry.token,
      sessionId: entry.sessionId,
      title: entry.title,
      createdAt: entry.createdAt,
      ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
      url: urls[0],
      urls,
      ...(entry.redactedCount !== undefined ? { redactedCount: entry.redactedCount } : {}),
    }
  }

  // The `/dsh-share-plus` Connection RPC channel. See `./rpc` for why this registers
  // the channel route directly on the web server instead of going through
  // `ctx.connection.rpc.handle()`, which cannot work from a patch-layer plugin
  // on this dsh version.
  registerRpcChannel(ctx, '/dsh-share-plus', async (endpoint: string, payload: unknown): Promise<RpcResult<unknown>> => {
    try {
      switch (endpoint) {
        case 'create': {
          const p = (payload ?? {}) as { sessionId?: unknown; expiresInSec?: unknown; redact?: RedactConfig; technical?: unknown }
          const sessionId = typeof p.sessionId === 'string' && p.sessionId !== '' ? p.sessionId : ''
          if (sessionId === '') {
            return { ok: false, error: { code: 'internal', message: 'missing sessionId', details: {} } }
          }
          const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike | undefined
          if (sessionQuery === undefined) {
            return { ok: false, error: { code: 'internal', message: 'sessionQuery is unavailable', details: {} } }
          }
          const read = await sessionQuery.readSession(sessionId)
          const redact = resolveRedact(config?.redact, p.redact)
          const technical = resolveTechnical(
            configuredTechnical(),
            typeof p.technical === 'boolean' ? p.technical : undefined,
          )
          const folded = foldTranscript(read.events, { redact, technical })
          // Statistics describe the machine-facing session (tokens, steps, tool
          // time). They are part of the technical view, so a readable share
          // carries none — and none is computed, so the work is skipped too.
          const stats = technical ? computeStats(read.events) : undefined
          // The stats header renders `model · provider` verbatim, which can name
          // a private route or an on-disk model path. Run those two fields
          // through the same rules instead of dropping them: an embedded
          // credential or home path is masked, an ordinary id stays readable.
          let redactedCount = folded.redactedCount
          if (stats !== undefined) {
            for (const field of ['model', 'provider'] as const) {
              const value = stats[field]
              if (value === undefined) continue
              const masked = redactText(value, redact)
              stats[field] = masked.text
              redactedCount += masked.count
            }
          }
          const expiresInSec = typeof p.expiresInSec === 'number' && p.expiresInSec > 0 ? p.expiresInSec : undefined
          const entry: ShareEntry = {
            token: randomBytes(16).toString('hex'),
            sessionId,
            title: deriveTitle(folded.entries, sessionId),
            createdAt: Date.now(),
            ...(expiresInSec !== undefined ? { expiresAt: Date.now() + expiresInSec * 1000 } : {}),
            entries: folded.entries,
            technical,
            ...(stats !== undefined ? { stats } : {}),
            redactedCount,
            ...(folded.unsupportedEvents !== undefined ? { unsupportedEvents: folded.unsupportedEvents } : {}),
          }
          await store.add(entry)
          // `add` evicts the oldest shares at MAX_SHARES; drop any cached page
          // whose share just left the store, so the cache can never outlive it.
          if (serverHandle !== null) {
            const live = new Set((await store.list()).map((e) => e.token))
            serverHandle.keepOnly(live)
          }
          const boundPort = await ensureServer()
          const value: CreateResult = { share: await buildShareInfo(entry, boundPort) }
          return { ok: true, value }
        }
        case 'revoke': {
          const p = (payload ?? {}) as { token?: unknown }
          const token = typeof p.token === 'string' && p.token !== '' ? p.token : ''
          if (token === '') {
            return { ok: false, error: { code: 'internal', message: 'missing token', details: {} } }
          }
          const removed = await store.remove(token)
          // Drop any cached render immediately: a revoked token must stop
          // serving on the next request, not when its cache entry ages out.
          serverHandle?.forget(token)
          return { ok: true, value: { removed } }
        }
        case 'list': {
          const entries = await store.list()
          const boundPort = serverHandle?.port ?? port
          const shares = await Promise.all(entries.map((e) => buildShareInfo(e, boundPort)))
          const value: ListResult = { shares }
          return { ok: true, value }
        }
        case 'defaults': {
          const value: DefaultsResult = {
            technical: configuredTechnical(),
            redact: resolveRedact(config?.redact, undefined).enabled,
          }
          return { ok: true, value }
        }
        case 'mounts': {
          // The settings card calls this after every save, so bringing the
          // server up here is what makes a mount added through the GUI actually
          // reachable without a restart.
          const boundPort = await ensureServer()
          const value: MountsResult = await buildMounts(boundPort)
          return { ok: true, value }
        }
        default:
          return { ok: false, error: { code: 'internal', message: `unknown endpoint: ${endpoint}`, details: {} } }
      }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'internal',
          message: err instanceof Error ? err.message : String(err),
          details: {},
        },
      }
    }
  })

  // Dispose: close the share server (registered listeners dropped via the
  // effect above).
  ctx.effect(() => () => {
    void serverHandle?.close()
  }, 'dsh-share-plus: share server lifecycle')

  // Start the share server at activation as soon as there is ANYTHING to
  // serve — a configured directory mount, or a share already in the store.
  //
  // Both matter after a restart. Shares are persisted and never expire by
  // default, so a link handed to someone must keep working across a dsh
  // restart; with a purely lazy start it silently 404s (nothing is listening)
  // until somebody happens to create another share.
  ctx.effect(() => {
    void (async () => {
      const [resolved, shares] = await Promise.all([resolveCurrentMounts(), store.list()])
      if (resolved.mounts.length === 0 && shares.length === 0) return
      await ensureServer()
    })().catch(() => {
      // A failed bind must not take the plugin down; the settings card reports
      // the state and the next share attempt retries.
    })
    return () => {}
  }, 'dsh-share-plus: eager share server')

  // Hourly background cleanup for expired shares so stale snapshots don't linger on disk.
  ctx.effect(() => {
    const timer = setInterval(() => {
      void store.cleanExpired()
    }, 60 * 60 * 1000)
    return () => clearInterval(timer)
  }, 'dsh-share-plus: prune expired timer')
}

// ---- public type surface (stable for downstream consumers) -------------------

export type { ShareInfo, TranscriptEntry } from '../shared/types'

/**
 * Default export carrying the settings schema.
 *
 * The loader normalises a module to `exports.default ?? exports` and reads the
 * settings schema off THAT object, so `Config` has to ride whatever the loader
 * picks. Shipping both the named exports (used by tests and by the named
 * import above) and a default object that also carries `Config` keeps the
 * schema reachable either way.
 */
export default { name, inject, apply, Config }
