/**
 * dsh-share — Connection RPC channel registration (host half).
 *
 * WHY THIS EXISTS INSTEAD OF `ctx.connection.rpc.handle()`
 * --------------------------------------------------------
 * The harness ships a generic channel registry, `ctx.connection.rpc.handle()`,
 * and that is the obvious way to expose `/dsh-share`. It does not work from a
 * profile patch-layer plugin on dsh 0.2 / cordis as currently composed:
 *
 *   HostConnectionService#register() ends with
 *     owner.effect(() => owner.webServer.register(route), ...)
 *   where `owner` is `this.ctx` read through the `rpc` getter. That read goes
 *   through cordis's traceable shadow: the accessor is invoked with a shadow
 *   context whose `[symbols.shadow]` slot holds the *connection service's own*
 *   context. Service lookup then starts at the connection plugin's fiber and
 *   walks up its ancestors — but `webServer` is provided by a SIBLING row, so
 *   it is never found and the access throws:
 *
 *     cannot get property "webServer" without inject
 *
 *   The consequence is that the entry fails to activate and every route it
 *   registered is rolled back. No shipped dsh plugin calls `rpc.handle` (they
 *   only call `rpc.intercept`, which never touches `webServer`), so the defect
 *   is latent upstream. It is reproducible on this dsh version from any
 *   third-party plugin.
 *
 * So this module registers the channel route directly on the injected
 * `webServer`, which is the pattern the harness itself uses for its own `/api`
 * route, and re-implements the (small, stable) wire contract the browser caller
 * speaks:
 *
 *   request   POST <channel>/<endpoint>
 *             content-type: application/json
 *             { type: 'client-request', rpcId, method, payload }
 *   response  { type: 'server-response', rpcId, result }
 *             result = { ok: true, value } | { ok: false, error: { code, message, details } }
 *
 * The channel keeps the harness's own admission fence: every request is first
 * put through the Connection service's trusted-Host/Origin + browser-auth
 * check, so this route is exactly as protected as a native RPC channel.
 */

import type { Context } from '@deepseek-ai/cordis'

/** A channel result, mirroring the harness's `RpcResult` shape. */
export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

/** The handler a channel endpoint is served by. */
export type RpcHandler = (endpoint: string, payload: unknown) => Promise<RpcResult<unknown>>

/** Minimal structural view of the harness web server route registry. */
interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: NodeRequest, res: NodeResponse) => void | Promise<void>
  }): () => void
}

/** Minimal structural view of the Connection service's request fence. */
interface ConnectionLike {
  requestRejection(req: NodeRequest): number | undefined
}

interface NodeRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  on(event: string, listener: (...args: never[]) => void): void
  destroy(): void
}

interface NodeResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

/** Context carrying the two services this channel needs. */
type RpcContext = Context & { connection: ConnectionLike; webServer: WebServerLike }

/** Body cap: payloads are a session id, an expiry, and redaction flags. */
const MAX_BODY_BYTES = 256 * 1024

/** Channel and endpoint names accepted by the harness caller. */
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read the whole request body, refusing anything over the cap. */
async function readBody(req: NodeRequest): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const done = (value: string | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (...args: never[]) => {
      if (settled) return
      const chunk = args[0] as unknown as Buffer
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // Stop reading AND tear the stream down: without `destroy` the client
        // could keep streaming into a socket nobody is consuming, which is the
        // slow-drip variant of the same overflow.
        done(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => done(null))
  })
}

/** Endpoint name for a request path, or undefined when the path is not a match. */
function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  return ENDPOINT_SEGMENT_PATTERN.test(endpoint) ? endpoint : undefined
}

function sendJson(res: NodeResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sendFailure(res: NodeResponse, rpcId: string, status: number, code: string, message: string): void {
  sendJson(res, status, {
    type: 'server-response',
    rpcId,
    result: { ok: false, error: { code, message, details: {} } },
  })
}

/**
 * Register `handler` as the Connection RPC channel `channel`.
 *
 * Defers until both `connection` and `webServer` are available, then keeps the
 * route registered for the lifetime of the returned fiber.
 */
export function registerRpcChannel(ctx: Context, channel: string, handler: RpcHandler): void {
  if (!CHANNEL_PATTERN.test(channel)) {
    throw new Error(`dsh-share: invalid RPC channel ${JSON.stringify(channel)}`)
  }

  ctx.inject(['connection', 'webServer'], (rpcCtx: Context) => {
    const { connection, webServer } = rpcCtx as RpcContext
    rpcCtx.effect(
      () =>
        webServer.register({
          kind: 'prefix',
          path: channel,
          handler: async (req: NodeRequest, res: NodeResponse) => {
            // Same fence a native channel applies: trusted Host/Origin, then
            // browser authentication. Unauthenticated callers get 401/403.
            const rejection = connection.requestRejection(req)
            if (rejection !== undefined) {
              res.writeHead(rejection)
              res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
              return
            }

            const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
            const endpoint = endpointFromPath(channel, pathname)
            const contentType = (req.headers['content-type'] ?? '').toString().split(';', 1)[0]?.trim().toLowerCase()
            if (req.method !== 'POST' || endpoint === undefined || contentType !== 'application/json') {
              sendFailure(res, '', 404, 'gateway/not-found', `no such endpoint: ${pathname}`)
              return
            }

            // Refuse an oversized body from its declared length alone, before
            // reading a byte: otherwise the server buffers up to the cap for
            // every such request just to reject it.
            const declared = Number(req.headers['content-length'] ?? '')
            if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
              sendFailure(res, '', 413, 'gateway/too-large', 'request body too large')
              req.destroy()
              return
            }

            const raw = await readBody(req)
            if (raw === null) {
              sendFailure(res, '', 413, 'gateway/too-large', 'request body too large')
              return
            }

            let envelope: unknown
            try {
              envelope = JSON.parse(raw)
            } catch {
              sendFailure(res, '', 400, 'gateway/bad-request', 'body is not JSON')
              return
            }

            const rpcId = isRecord(envelope) && typeof envelope.rpcId === 'string' ? envelope.rpcId : ''
            if (
              !isRecord(envelope) ||
              envelope.type !== 'client-request' ||
              rpcId === '' ||
              typeof envelope.method !== 'string'
            ) {
              sendFailure(res, rpcId, 400, 'gateway/bad-request', 'invalid client-request message')
              return
            }

            if (envelope.method !== endpoint) {
              sendFailure(
                res,
                rpcId,
                400,
                'gateway/bad-request',
                `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
              )
              return
            }

            let result: RpcResult<unknown>
            try {
              result = await handler(endpoint, envelope.payload)
            } catch (err) {
              result = {
                ok: false,
                error: {
                  code: 'internal',
                  message: err instanceof Error ? err.message : String(err),
                  details: {},
                },
              }
            }
            sendJson(res, 200, { type: 'server-response', rpcId, result })
          },
        }),
      `dsh-share: rpc channel ${channel}`,
    )
  })
}
