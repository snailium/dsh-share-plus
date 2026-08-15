/**
 * Token pricing — the same fixed-density heuristic as the harness's own
 * token-meter (`dsh-token-meter`): ~4 chars ≈ 1 token, +4 per content block,
 * +4 role framing. Pure functions over message payloads, used to estimate the
 * current context composition for the share-page stats.
 */

const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4

export interface ContentBlock {
  type?: string
  text?: string
  name?: string
  arguments?: string
  content?: ContentBlock[]
  callId?: string
}

function estimateBlocks(blocks: ContentBlock[] | undefined): number {
  let tokens = 0
  if (!Array.isArray(blocks)) return 0
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += Math.ceil(String(block.text || '').length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += Math.ceil(String(block.name || '').length / CHARS_PER_TOKEN)
          + Math.ceil(String(block.arguments || '').length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
        break
      case 'tool-result':
        tokens += estimateBlocks(block.content) + BLOCK_OVERHEAD
        break
      default:
        tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN)
    }
  }
  return tokens
}

/** Whole-array tool-schema price (the header's tools total). */
export function estimateToolsTotal(tools: unknown[]): number {
  return tools.length > 0
    ? Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
    : 0
}

export function estimateSystem(text: unknown): number {
  if (typeof text !== 'string' || text.length === 0) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD
}

/**
 * Price one surface message exactly like the token-meter estimate: an
 * empty-content assistant/message projects to NO message (it only hosts
 * usage), so it prices 0; every other message pays content + role framing.
 */
export function estimateMessage(message: { content?: ContentBlock[] } | undefined | null, emptyIsZero = false): number {
  if (emptyIsZero && (message === null || message === undefined
    || !Array.isArray(message.content) || message.content.length === 0)) {
    return 0
  }
  return estimateBlocks(message?.content) + ROLE_OVERHEAD
}

export interface MessageSource {
  kind?: string
  form?: string
  name?: string
  plugin?: string
  summary?: string
}

/** Plugin context and user-explicit skill invocations ride user-role messages. */
export function isInjection(source: MessageSource | undefined | null): boolean {
  return source !== null && typeof source === 'object'
    && (source.kind === 'plugin' || source.kind === 'skill-invocation' || typeof source.form === 'string')
}
