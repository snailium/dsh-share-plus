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

interface ContentBlock {
  type?: string
  text?: string
  name?: string
  content?: ContentBlock[]
  callId?: string
}

/** First non-empty text across a content array (walking nested tool results). */
function firstText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const b = block as ContentBlock
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') {
      return b.text.replace(/\s+/g, ' ').trim()
    }
    if (b.type === 'tool-result' || Array.isArray(b.content)) {
      const nested = firstText(b.content)
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

export function foldTranscript(events: readonly SessionEvent[]): TranscriptEntry[] {
  // callId -> tool name, resolved from tool/call events.
  const callNames: Record<string, string> = {}
  for (const ev of events) {
    if (ev.type !== 'tool/call') continue
    const data = ev.data as { callId?: unknown; name?: unknown } | undefined
    if (data !== undefined && data.callId !== undefined && typeof data.name === 'string') {
      callNames[String(data.callId)] = data.name
    }
  }

  const out: TranscriptEntry[] = []
  for (const ev of events) {
    if (isReplacement(ev)) continue
    const data = ev.data as Record<string, unknown> | undefined

    switch (ev.type) {
      case 'user/message': {
        const source = (data?.source ?? {}) as { kind?: string; name?: string; form?: string }
        if (source.kind === 'plugin' || source.kind === 'skill-invocation') {
          const label = source.kind === 'skill-invocation'
            ? `Skill: ${typeof source.name === 'string' ? source.name : '?'}`
            : `上下文注入${typeof source.form === 'string' ? ` · ${source.form}` : ''}`
          const text = firstText(data?.content)
          out.push(entry('context', ev, { text: text !== '' ? text : label, tool: source.kind === 'skill-invocation' ? source.name : undefined }))
        } else {
          const text = firstText(data?.content)
          if (text !== '') out.push(entry('user', ev, { text }))
        }
        break
      }
      case 'assistant/message': {
        const message = (data?.message ?? {}) as { content?: unknown }
        const text = firstText(message.content)
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
  return out
}

/** A short display title: first real user message, else the session id. */
export function deriveTitle(entries: TranscriptEntry[], sessionId: string): string {
  for (const e of entries) {
    if (e.role === 'user' && e.text !== '') return e.text.slice(0, 40)
  }
  return `Session ${sessionId.slice(0, 8)}`
}
