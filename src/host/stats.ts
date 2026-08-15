/**
 * Session statistics — folds a raw event log once into the share-page summary:
 * turn/step counts, active execution duration (sum of turn spans — excludes
 * idle time between turns), total tool-call time, cache read/write,
 * provider-reported input/output tokens, and the current context window
 * occupancy broken down by category (system / tool schemas / user / injected /
 * assistant / tool results). The context composition reuses the token-meter
 * heuristic (pricing.ts) and mirrors dsh's surface fold.
 */

import type { ShareStats } from '../shared/types'
import type { SessionEvent } from './services'
import { estimateMessage, estimateSystem, estimateToolsTotal, isInjection, type ContentBlock } from './pricing'

type Category = 'user' | 'inject' | 'assistant' | 'tool'

interface SurfaceNode { seq: number; cat: Category; tokens: number }

function categoryOf(type: string, message: { source?: unknown } | undefined): Category {
  if (type === 'assistant/message') return 'assistant'
  if (type === 'tool/result') return 'tool'
  if (isInjection(message?.source as { kind?: string; form?: string } | undefined)) return 'inject'
  return 'user'
}

/** Append one surface node, honoring a positional replace op on the range. */
function applySurface(surface: SurfaceNode[], sums: Record<Category, number>, ev: SessionEvent, cat: Category, tokens: number): void {
  const op = ev.surfaceOp as { op?: string; start?: number; end?: number } | null | undefined
  if (op !== null && typeof op === 'object' && op.op === 'replace') {
    let si = -1
    let ei = -1
    for (let i = 0; i < surface.length; i++) {
      if (si < 0 && surface[i].seq === op.start) si = i
      if (surface[i].seq === op.end) { ei = i; break }
    }
    if (si >= 0 && ei >= si) {
      const removed = surface.splice(si, ei - si + 1)
      for (const r of removed) sums[r.cat] -= r.tokens
    }
  }
  surface.push({ seq: ev.seq, cat, tokens })
  sums[cat] += tokens
}

function toolResultCallId(data: Record<string, unknown> | undefined): string | undefined {
  if (data === undefined) return undefined
  const message = data.message as { source?: { callId?: string }; content?: { callId?: string }[] } | undefined
  const id = message?.source?.callId ?? message?.content?.[0]?.callId ?? data.callId
  return typeof id === 'string' ? id : undefined
}

export function computeStats(events: readonly SessionEvent[]): ShareStats {
  const surface: SurfaceNode[] = []
  const sums: Record<Category, number> = { user: 0, inject: 0, assistant: 0, tool: 0 }

  let systemTokens = 0
  let toolsTokens = 0
  let model: string | undefined
  let provider: string | undefined
  let contextWindow: number | undefined

  let turns = 0
  let steps = 0
  let minTime: number | undefined
  let maxTime: number | undefined
  let lastEventTime: number | undefined

  // Active execution = sum of turn spans (turn/start → turn/end). This is the
  // headline "execution duration": idle time between the user's turns does not
  // count. Falls back to the wall-clock span when the log has no turn
  // boundaries.
  let turnStartTime: number | undefined
  let totalTurnMs = 0

  let toolCallMs = 0
  const callStarts = new Map<string, number>()

  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let inputTokens = 0
  let outputTokens = 0

  for (const ev of events) {
    if (typeof ev.time === 'number') {
      minTime = minTime === undefined ? ev.time : Math.min(minTime, ev.time)
      maxTime = maxTime === undefined ? ev.time : Math.max(maxTime, ev.time)
      lastEventTime = ev.time
    }

    switch (ev.type) {
      case 'turn/start':
        turns += 1
        if (ev.time !== undefined) turnStartTime = ev.time
        break
      case 'turn/end':
        if (turnStartTime !== undefined && ev.time !== undefined && ev.time >= turnStartTime) {
          totalTurnMs += ev.time - turnStartTime
        }
        turnStartTime = undefined
        break
      case 'step/start':
        steps += 1
        break
      case 'request/header': {
        const header = (ev.data as { header?: { system?: unknown; tools?: unknown[]; config?: { model?: unknown; provider?: unknown } } } | undefined)?.header
        const tools = Array.isArray(header?.tools) ? header.tools : []
        toolsTokens = estimateToolsTotal(tools)
        systemTokens = estimateSystem(header?.system)
        if (header?.config !== undefined) {
          if (typeof header.config.model === 'string') model = header.config.model
          if (typeof header.config.provider === 'string') provider = header.config.provider
        }
        break
      }
      case 'request/context': {
        const data = ev.data as { contextWindow?: unknown; model?: unknown; provider?: unknown } | undefined
        if (data !== undefined) {
          if (typeof data.contextWindow === 'number') contextWindow = data.contextWindow
          if (typeof data.model === 'string') model = data.model
          if (typeof data.provider === 'string') provider = data.provider
        }
        break
      }
      case 'tool/call': {
        const data = ev.data as { callId?: unknown } | undefined
        if (data !== undefined && data.callId !== undefined && ev.time !== undefined) {
          callStarts.set(String(data.callId), ev.time)
        }
        break
      }
      case 'tool/result': {
        const data = ev.data as Record<string, unknown> | undefined
        const callId = toolResultCallId(data)
        if (callId !== undefined && ev.time !== undefined) {
          const start = callStarts.get(callId)
          if (start !== undefined && ev.time >= start) toolCallMs += ev.time - start
        }
        const msg = data?.message as { content?: ContentBlock[] } | undefined
        applySurface(surface, sums, ev, 'tool', estimateMessage(msg, false))
        break
      }
      case 'user/message': {
        const msg = ev.data as { content?: ContentBlock[]; source?: unknown } | undefined
        applySurface(surface, sums, ev, categoryOf('user/message', msg), estimateMessage(msg, false))
        break
      }
      case 'assistant/message': {
        const data = ev.data as { message?: { content?: ContentBlock[] }; usage?: { inputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; outputTokens?: number } } | undefined
        const usage = data?.usage
        if (usage !== undefined) {
          if (typeof usage.inputTokens === 'number') inputTokens += usage.inputTokens
          if (typeof usage.cacheReadTokens === 'number') cacheReadTokens += usage.cacheReadTokens
          if (typeof usage.cacheWriteTokens === 'number') cacheWriteTokens += usage.cacheWriteTokens
          if (typeof usage.outputTokens === 'number') outputTokens += usage.outputTokens
        }
        const msg = data?.message as { content?: ContentBlock[] } | undefined
        applySurface(surface, sums, ev, 'assistant', estimateMessage(msg, true))
        break
      }
      default:
        break
    }
  }

  // Fallbacks for logs that carry no turn/step boundary events: derive from
  // answered model calls (each assistant/message is one step).
  if (steps === 0) {
    let count = 0
    for (const ev of events) if (ev.type === 'assistant/message') count += 1
    steps = count
  }

  // Close an in-progress (open) turn against the last event time.
  if (turnStartTime !== undefined && lastEventTime !== undefined && lastEventTime >= turnStartTime) {
    totalTurnMs += lastEventTime - turnStartTime
  }

  const wallSpanMs = (minTime !== undefined && maxTime !== undefined) ? Math.max(0, maxTime - minTime) : 0
  const durationMs = totalTurnMs > 0 ? totalTurnMs : wallSpanMs

  const contextTotal = systemTokens + toolsTokens + sums.user + sums.inject + sums.assistant + sums.tool
  return {
    turns,
    steps,
    durationMs,
    toolCallMs,
    cacheReadTokens,
    cacheWriteTokens,
    inputTokens,
    outputTokens,
    ...(model !== undefined ? { model } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    context: {
      system: systemTokens,
      tools: toolsTokens,
      user: sums.user,
      inject: sums.inject,
      assistant: sums.assistant,
      tool: sums.tool,
      total: contextTotal,
    },
  }
}
