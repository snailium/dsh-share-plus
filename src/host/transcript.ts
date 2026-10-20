/**
 * Transcript folding — projects a session's raw event log into a compact,
 * human-readable transcript (frozen at share time).
 *
 * Only APPEND-ORIGIN surface events become transcript lines: replacement
 * copies (surfaceOp is an object) restate a shadowed range for the model alone
 * and would duplicate conversation the user already saw. Tool calls/results are
 * collapsed to one muted line each (the "conversation text" scope), and plugin
 * / skill context injections are folded into a muted `context` line so the
 * transcript is not misleadingly empty.
 */

import type { TranscriptEntry, TranscriptRole } from '../shared/types'
import type { SessionEvent } from './services'
import { redactText, type RedactOptions } from './redact'

interface ContentBlock {
  type?: string
  text?: string
  name?: string
  content?: ContentBlock[]
  callId?: string
}

/**
 * First non-empty text across a content array.
 *
 * `walkToolResults` controls whether the search recurses into embedded
 * tool-result blocks. The user/assistant message paths pass `false`: raw
 * command output (a `cat .env`, a DB dump) must never leak into a share
 * snapshot through this side channel — the dedicated `tool/result` events are
 * already collapsed to name-only lines. Context-injection text still walks,
 * since injected notes are legitimate conversation surface.
 */
function firstText(content: unknown, walkToolResults = true): string {
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const b = block as ContentBlock
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') {
      // Preserve the author's line structure. Collapsing every whitespace run
      // here (the original behaviour) destroyed newlines BEFORE Markdown ever
      // saw the text, so multi-line prompts and answers rendered as one long
      // run and no renderer setting could recover them. Only CRLF is
      // normalised; the title flattens its own single line separately.
      return b.text.replace(/\r\n?/g, '\n').trim()
    }
    if (walkToolResults && (b.type === 'tool-result' || Array.isArray(b.content))) {
      const nested = firstText(b.content, true)
      if (nested !== '') return nested
    }
  }
  return ''
}

/** All tool-call names in a content array. */
function toolCallNames(content: unknown): string[] {
  const names: string[] = []
  if (!Array.isArray(content)) return names
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const b = block as ContentBlock
    if (b.type === 'tool-call' && typeof b.name === 'string') names.push(b.name)
  }
  return names
}

/** Whether an event is a surface replacement copy (model-only restatement). */
function isReplacement(ev: SessionEvent): boolean {
  return ev.surfaceOp !== undefined && ev.surfaceOp !== 'append'
}

function entry(role: TranscriptRole, ev: SessionEvent, fields: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return { role, time: ev.time, text: '', ...fields }
}

export interface FoldOptions {
  /** Redaction options; default ON. Applied to every entry before returning. */
  redact?: RedactOptions
  /**
   * Whether to keep the machine-facing parts of the session. Default `true`
   * (the historical behaviour): tool calls/results, injected context, system
   * notices and every assistant message.
   *
   * `false` produces a READABLE transcript: the prompts the user typed and the
   * final answer of each turn, nothing else. In an agentic session the
   * technical stream is thousands of lines of tool chatter that buries the
   * actual exchange, so this is the default for a share.
   */
  technical?: boolean
}

/** Total number of redactions across all entries (for the "N items redacted" UI). */
export interface FoldResult {
  entries: TranscriptEntry[]
  redactedCount: number
  /**
   * Set when the session carried event types this build does not understand.
   *
   * The plugin's contract is the session record format, not a harness version:
   * it reads three of the vocabulary's events (`user/message`,
   * `assistant/message`, `tool/result`) plus `seq`/`time`/`data`. A newer
   * format that renames or adds a *rendered* event would otherwise be dropped
   * in silence, and a short share page would look like an empty conversation
   * rather than a version mismatch. Unknown events are still skipped safely —
   * this only makes that visible to the reader.
   */
  unsupportedEvents?: {
    /** How many events were skipped because their type is not recognised. */
    count: number
    /** A few of the unrecognised type names, for the banner. */
    types: string[]
  }
}

/**
 * The session event types this build renders. Everything else is skipped.
 * Mirrors a subset of the harness's `KNOWN_SESSION_EVENT_TYPES` (format v4);
 * the point of listing them is to tell "an event we deliberately ignore"
 * (`step/start`, `llm/retry`, …) apart from "an event we have never heard of".
 */
const RENDERED_EVENT_TYPES = new Set([
  'user/message',
  'assistant/message',
  'tool/result',
  'tool/call',
])

/**
 * Format-v4 event types this build knows about and deliberately does not
 * render. Listing them is what keeps the "unsupported format" banner honest:
 * a session full of `step/start` and `llm/retry` is perfectly normal, while an
 * event type absent from BOTH this set and {@link RENDERED_EVENT_TYPES} is
 * evidence the record was written by a format this build does not know.
 *
 * Sourced from the harness's `KNOWN_SESSION_EVENT_TYPES` (62 entries, format 4)
 * minus the rendered four. The list is verified against the installed harness
 * by `tests/vocabulary.test.mjs`, so a harness release that adds an event type
 * fails the suite instead of making every share page cry wolf.
 */
const KNOWN_IGNORED_EVENT_TYPES = new Set([
  'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked', 'approval/decided',
  'approval/policy', 'assistant/attempt', 'command/done', 'command/run', 'compaction/end',
  'compaction/prune', 'compaction/start', 'compaction/summary', 'deliverables/presented',
  'developer/message', 'feedback/message-delete', 'feedback/message-put', 'feedback/record',
  'goal/change', 'hook/invoked', 'hook/result', 'image/offload', 'job/registered',
  'job/settled', 'llm/retry',
  'llm/retry-started', 'model/selection', 'permission/preset', 'plan/mode', 'request/context',
  'request/header', 'sandbox/mode', 'schedule/change', 'session-log-deepseek/delivery-accepted',
  'session/end-seed', 'session/title', 'session/title-llm-request', 'step/end', 'step/start',
  'subagent/catalog', 'subagent/descriptor', 'subagent/model-selection-policy',
  'system/message', 'team/member', 'team/message/delivered', 'team/message/queued',
  'team/task', 'todo/write', 'tool-workflow/agent-end', 'tool-workflow/agent-start',
  'tool-workflow/run-end', 'tool-workflow/run-start', 'tool/ptc-dispatch',
  'tool/ptc-dispatch-start', 'turn/end', 'turn/start', 'web/deepseek-search-llm-request',
  'working-directory/change', 'workspace/changes',
])

export function foldTranscript(events: readonly SessionEvent[], opts?: FoldOptions): FoldResult {
  // callId -> tool name, resolved from tool/call events.
  const callNames: Record<string, string> = {}
  for (const ev of events) {
    if (ev.type !== 'tool/call') continue
    const data = ev.data as { callId?: unknown; name?: unknown } | undefined
    if (data !== undefined && data.callId !== undefined && typeof data.name === 'string') {
      callNames[String(data.callId)] = data.name
    }
  }

  const unknownTypes = new Set<string>()
  let unknownCount = 0

  const out: TranscriptEntry[] = []
  for (const ev of events) {
    if (isReplacement(ev)) continue
    const data = ev.data as Record<string, unknown> | undefined

    // An event type outside the format-v4 vocabulary we render means this
    // session was written by a newer/older format. `*/...` shaped types are
    // recorded; harness-internal namespaces without a slash are not, because
    // they are not part of the session-record vocabulary.
    if (typeof ev.type === 'string' && !RENDERED_EVENT_TYPES.has(ev.type) && ev.type.includes('/') && !KNOWN_IGNORED_EVENT_TYPES.has(ev.type)) {
      unknownCount += 1
      if (unknownTypes.size < 5) unknownTypes.add(ev.type)
    }

    switch (ev.type) {
      case 'user/message': {
        const source = (data?.source ?? {}) as { kind?: string; name?: string; form?: string }
        // Only `kind: 'user'` is something the human typed. Everything else is
        // added by the harness: plugin notices, skill invocations, and the
        // periodic `runtime-context` snapshot (sandbox/approval policy) which
        // used to fall through and be shown as if the user had written it.
        const kind = typeof source.kind === 'string' ? source.kind : 'user'
        if (kind !== 'user') {
          const label = kind === 'skill-invocation'
            ? `Skill: ${typeof source.name === 'string' ? source.name : '?'}`
            : kind === 'runtime-context'
              ? '运行时上下文'
              : kind === 'plugin'
                ? `上下文注入${typeof source.form === 'string' ? ` · ${source.form}` : ''}`
                : `上下文注入 · ${kind}`
          const text = firstText(data?.content, true)
          out.push(entry('context', ev, { text: text !== '' ? text : label, tool: kind === 'skill-invocation' ? source.name : undefined }))
        } else {
          // Option B: never pull embedded tool output into user text.
          const text = firstText(data?.content, false)
          if (text !== '') out.push(entry('user', ev, { text }))
        }
        break
      }
      case 'assistant/message': {
        const message = (data?.message ?? {}) as { content?: unknown }
        // Option B: never pull embedded tool output into assistant text.
        const text = firstText(message.content, false)
        const calls = toolCallNames(message.content)
        if (text !== '') out.push(entry('assistant', ev, { text }))
        else if (calls.length > 0) out.push(entry('tool', ev, { calls }))
        break
      }
      case 'tool/result': {
        const message = (data?.message ?? {}) as { content?: unknown; source?: { callId?: string } }
        const block = Array.isArray(message.content) ? (message.content[0] as ContentBlock | undefined) : undefined
        const callId = block?.callId !== undefined ? String(block.callId) : message.source?.callId
        const name = callId !== undefined ? callNames[callId] : undefined
        out.push(entry('tool', ev, { tool: name }))
        break
      }
      default:
        break
    }
  }

  // "Readable" mode: keep the prompts and the answer that concluded each turn.
  //
  // Tool entries and context injections are dropped outright. Among the
  // assistant messages of one turn, only the LAST one survives — an agentic
  // turn emits a "let me check X" message before nearly every tool call, and
  // keeping them all is what makes the page unreadable. A pending assistant
  // message is flushed when the next prompt arrives, so the result reads as
  // prompt → answer pairs in the original order.
  if (opts?.technical === false) {
    const kept: TranscriptEntry[] = []
    let pendingAnswer: TranscriptEntry | null = null
    for (const e of out) {
      if (e.role === 'tool' || e.role === 'context') continue
      if (e.role === 'assistant') {
        pendingAnswer = e
        continue
      }
      if (pendingAnswer !== null) {
        kept.push(pendingAnswer)
        pendingAnswer = null
      }
      kept.push(e)
    }
    if (pendingAnswer !== null) kept.push(pendingAnswer)
    out.length = 0
    out.push(...kept)
  }

  // Option A: redact every entry text before it can reach the snapshot (this
  // also covers any text that still arrives via firstText). Redaction happens
  // HERE, before deriveTitle, so the title inherits the masked text.
  const redactOpts: RedactOptions = opts?.redact ?? { enabled: true }
  let redactedCount = 0
  if (redactOpts.enabled) {
    for (const e of out) {
      if (e.text === '') continue
      const r = redactText(e.text, redactOpts)
      e.text = r.text
      redactedCount += r.count
    }
  }
  return {
    entries: out,
    redactedCount,
    ...(unknownCount > 0 ? { unsupportedEvents: { count: unknownCount, types: [...unknownTypes] } } : {}),
  }
}

/** A short display title: first real user message, else the session id. */
export function deriveTitle(entries: TranscriptEntry[], sessionId: string): string {
  for (const e of entries) {
    // The title is one line by definition, so flatten here rather than in
    // firstText (which must keep the body's line structure intact).
    if (e.role === 'user' && e.text !== '') return e.text.replace(/\s+/g, ' ').trim().slice(0, 40)
  }
  return `Session ${sessionId.slice(0, 8)}`
}
