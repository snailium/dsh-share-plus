/**
 * Host-side service contracts — the exact API surface this plugin consumes
 * from the harness. TYPE-ONLY: the runtime services come from the user's
 * harness. The `Context` augmentation below types `ctx.connection`,
 * `ctx.sessionQuery`, and `ctx.sessions` for the whole Host half.
 */

import type { Context } from '@deepseek-ai/cordis'

/** A minimal session-log event, as folded by this plugin. */
export interface SessionEvent {
  seq: number
  type: string
  time: number
  data?: unknown
  surfaceOp?: unknown
}

/** The generic Connection RPC channel registry (`ctx.connection.rpc`). */
export interface HostConnectionRpc {
  handle(
    channel: string,
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>,
    options: { authority: 'trusted-host' | 'loopback' },
  ): () => Promise<void>
}

/** The harness RpcResult envelope ({ok:true,value} | {ok:false,error}). */
export type RpcError = { code: string; message: string; details?: unknown }
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError }

/** The live-preferred session read service (`ctx.sessionQuery`). */
export interface SessionQueryLike {
  readSession(id: string): Promise<{ session: unknown; events: readonly SessionEvent[] }>
  readTitle(id: string): Promise<string | undefined>
}

/** The in-memory store of LIVE sessions (`ctx.sessions`). */
export interface SessionStoreLike {
  get(id: string): { readonly events: readonly SessionEvent[] } | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: { rpc: HostConnectionRpc }
    sessionQuery?: SessionQueryLike
    sessions?: SessionStoreLike
  }
}
