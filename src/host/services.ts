/**
 * Host-side service contracts — the exact API surface this plugin consumes
 * from the harness. TYPE-ONLY: the runtime services come from the user's
 * harness. The `Context` augmentation below types `ctx.sessionQuery` and
 * `ctx.sessions` for the whole Host half.
 *
 * Note: this plugin deliberately does NOT consume `ctx.connection.rpc`. That
 * registry cannot register a channel route from a profile patch-layer plugin on
 * this dsh version — see the module comment in `./rpc.ts` for the full cause.
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
    sessionQuery?: SessionQueryLike
    sessions?: SessionStoreLike
  }
}
