/**
 * Shared wire contract — exchanged between the Host and Client halves over the
 * `/dsh-share` Connection RPC channel.
 *
 * TYPE-ONLY module: both halves import these as `import type`, so nothing from
 * here ever reaches the runtime bundles.
 */

/** Transcript role buckets (tool calls/results are collapsed for readability). */
export type TranscriptRole = 'user' | 'assistant' | 'tool' | 'context'

/** One rendered transcript line (frozen at share time). */
export interface TranscriptEntry {
  role: TranscriptRole
  /** Event timestamp (ms epoch); optional. */
  time?: number
  /** The message text (empty for tool entries, which carry `tool`/`calls`). */
  text: string
  /** Tool name for a collapsed tool result. */
  tool?: string
  /** Tool names for a collapsed assistant tool-call step. */
  calls?: string[]
}

/** Public share metadata the Client renders (never carries the transcript). */
export interface ShareInfo {
  token: string
  sessionId: string
  title: string
  createdAt: number
  expiresAt?: number
  /** Primary URL (first LAN address, falling back to loopback). */
  url: string
  /** All candidate URLs (LAN addresses + loopback), for the picker. */
  urls: string[]
}

/** The six priced context buckets (system/tools + the four surface categories). */
export interface ContextBreakdown {
  system: number
  tools: number
  user: number
  inject: number
  assistant: number
  tool: number
  total: number
}

/** Session statistics frozen into the snapshot (rendered on the share page). */
export interface ShareStats {
  turns: number
  steps: number
  /** Wall-clock span of the session log (ms). */
  durationMs: number
  /** Total time spent inside tool calls (call → result, ms). */
  toolCallMs: number
  /** Provider-reported cache read tokens (cache hits). */
  cacheReadTokens: number
  /** Provider-reported cache write tokens. */
  cacheWriteTokens: number
  /** Provider-reported base input tokens (excludes cache read/write). */
  inputTokens: number
  /** Provider-reported output tokens. */
  outputTokens: number
  model?: string
  provider?: string
  contextWindow?: number
  context: ContextBreakdown
}

export interface CreateResult {
  share: ShareInfo
}

export interface ListResult {
  shares: ShareInfo[]
}
