/**
 * Shared wire contract — exchanged between the Host and Client halves over the
 * `/dsh-share-plus` Connection RPC channel.
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
  /** Primary URL, derived at read time from the current domain and bound port. */
  url: string
  /** All candidate URLs (public domain first when set, then LAN), for the picker. */
  urls: string[]
  /** Number of secret patterns redacted when this snapshot was frozen. */
  redactedCount?: number
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
  /** Active execution time (sum of turn spans; falls back to wall-clock span). */
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

/**
 * Effective defaults the dialog seeds its per-share toggles from, so a checkbox
 * reflects the configured default instead of a hard-coded guess.
 */
export interface DefaultsResult {
  /** Whether a new share includes technical output unless overridden. */
  technical: boolean
  /** Whether a new share redacts secrets unless overridden. */
  redact: boolean
}

/**
 * One configured directory mount as the settings card sees it: the configured
 * values, whether the Host is actually serving it, and the URLs to copy.
 */
export interface MountView {
  name: string
  /** Path exactly as configured. */
  path: string
  /** Resolved absolute path when the mount is servable, else null. */
  root: string | null
  /** Whether a token is required (the token itself is never sent). */
  token: boolean
  index: boolean
  hidden: boolean
  status: 'serving' | 'invalid'
  /** Why the mount is not being served, when `status` is 'invalid'. */
  reason?: string
  /** Reachable URLs, including the token segment when one is configured. */
  urls: string[]
}

export interface MountsResult {
  mounts: MountView[]
  /** LAN addresses the URLs were built from, for display. */
  lanIps: string[]
  /** Set when the user configured a public domain; generated URLs lead with it. */
  publicDomain?: string
}

