/**
 * Share-page rendering — turns a frozen transcript (plus its session stats)
 * into a fully self-contained HTML page (no external assets, no JavaScript).
 * Message text is Markdown-rendered on the host with safe defaults (raw HTML
 * escaped, dangerous URLs rejected), so the served page stays non-executable.
 */

import type { ShareStats, TranscriptEntry } from '../shared/types'
import { renderMarkdown } from './markdown'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmtTime(t: number): string {
  const d = new Date(t)
  const p = (x: number) => (x < 10 ? '0' : '') + x
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(Math.round(n))
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

const CONTEXT_CATS: { key: keyof ShareStats['context']; label: string; color: string }[] = [
  { key: 'system', label: '系统提示', color: '#6366f1' },
  { key: 'tools', label: '工具定义', color: '#f59e0b' },
  { key: 'user', label: '用户消息', color: '#22c55e' },
  { key: 'inject', label: '注入上下文', color: '#a855f7' },
  { key: 'assistant', label: '助手回复', color: '#3b82f6' },
  { key: 'tool', label: '工具结果', color: '#14b8a6' },
]

const FOLD_THRESHOLD = 400
const PREVIEW_LENGTH = 320
const PREVIEW_LINES = 6

/**
 * Render message text, auto-folding long messages behind a native
 * `<details>`/`<summary>` disclosure (no JavaScript — stays XSS-safe). Short
 * messages render inline; long ones show a single-line preview with an
 * 展开全文/收起 toggle.
 */
/**
 * Preview for a folded message.
 *
 * Takes the opening LINES, not the opening characters of a whitespace-collapsed
 * string. Collapsing to one line is what made a long answer look like an
 * unreadable single run of text behind an "expand" control; keeping the line
 * structure means the preview reads like the answer it is previewing.
 */
function foldPreview(text: string): string {
  const lines: string[] = []
  let used = 0
  for (const line of text.split('\n')) {
    if (lines.length >= PREVIEW_LINES || used >= PREVIEW_LENGTH) break
    lines.push(line)
    used += line.length + 1
  }
  const joined = lines.join('\n')
  const clipped = joined.length > PREVIEW_LENGTH ? `${joined.slice(0, PREVIEW_LENGTH)}…` : joined
  return text.split('\n').length > lines.length ? `${clipped}\n…` : clipped
}

function renderText(text: string, technical: boolean): string {
  // A readable share never hides the answer behind a disclosure control.
  if (!technical || text.length <= FOLD_THRESHOLD) return renderMarkdown(text)
  return `<details class="fold"><summary><span class="preview">${escapeHtml(foldPreview(text))}</span><span class="toggle"></span></summary><div class="full">${renderMarkdown(text)}</div></details>`
}

function entryHtml(e: TranscriptEntry, technical: boolean): string {
  const time = e.time !== undefined ? `<div class="time">${fmtTime(e.time)}</div>` : ''
  if (e.role === 'tool') {
    if (e.calls !== undefined && e.calls.length > 0) {
      return `<div class="row tool">${time}<div class="bubble">🔧 调用工具 · <code>${escapeHtml(e.calls.join(', '))}</code></div></div>`
    }
    return `<div class="row tool">${time}<div class="bubble">↩ 工具结果${e.tool !== undefined ? ` · <code>${escapeHtml(e.tool)}</code>` : ''}</div></div>`
  }
  if (e.role === 'context') {
    return `<div class="row context">${time}<div class="bubble">${renderText(e.text, technical)}</div></div>`
  }
  if (e.role === 'assistant') {
    // dsh renders an answer as plain, full-width text — no bubble.
    return `<div class="row assistant"><div class="answer">${renderText(e.text, technical)}</div>${time}</div>`
  }
  return `<div class="row user">${time}<div class="bubble">${renderText(e.text, technical)}</div></div>`
}

function toolLine(e: TranscriptEntry): string {
  const time = e.time !== undefined ? `<span class="ttime">${fmtTime(e.time)}</span>` : ''
  const body = e.calls !== undefined && e.calls.length > 0
    ? `🔧 调用工具 · <code>${escapeHtml(e.calls.join(', '))}</code>`
    : `↩ 工具结果${e.tool !== undefined ? ` · <code>${escapeHtml(e.tool)}</code>` : ''}`
  return `<div class="trow">${time}${body}</div>`
}

/** Group a run of consecutive tool entries into one collapsible disclosure. */
function renderToolRun(run: TranscriptEntry[], technical: boolean): string {
  if (run.length === 1) return entryHtml(run[0]!, technical)
  const names: string[] = []
  for (const e of run) {
    if (e.calls !== undefined) for (const c of e.calls) if (!names.includes(c)) names.push(c)
    if (e.tool !== undefined && !names.includes(e.tool)) names.push(e.tool)
  }
  const label = names.length > 0
    ? `🛠 工具调用 · <code>${escapeHtml(names.join(', '))}</code>`
    : '🛠 工具调用'
  const lines = run.map(toolLine).join('')
  return `<div class="row toolgroup"><details class="toolrun"><summary><span class="tl">${label}</span><span class="toggle"></span></summary><div class="toolrun-body">${lines}</div></details></div>`
}

/** Render entries, folding consecutive tool calls/results into one group. */
function renderEntries(entries: TranscriptEntry[], technical: boolean): string {
  const out: string[] = []
  let run: TranscriptEntry[] = []
  const flush = (): void => {
    if (run.length === 0) return
    out.push(renderToolRun(run, technical))
    run = []
  }
  for (const e of entries) {
    if (e.role === 'tool') { run.push(e); continue }
    flush()
    out.push(entryHtml(e, technical))
  }
  flush()
  return out.join('\n')
}

function statsHtml(stats: ShareStats): string {
  const c = stats.context
  const window = stats.contextWindow
  const pct = window !== undefined && window > 0 ? Math.min(100, Math.round(c.total / window * 100)) : null
  const scale = window !== undefined && window > c.total ? window : c.total

  const inputTotal = stats.inputTokens + stats.cacheReadTokens + stats.cacheWriteTokens

  const cells: [string, string][] = [
    ['轮次', fmtNum(stats.turns)],
    ['步数', fmtNum(stats.steps)],
    ['执行时长', fmtDuration(stats.durationMs)],
    ['工具调用时长', fmtDuration(stats.toolCallMs)],
    ['缓存命中', fmtNum(stats.cacheReadTokens)],
    ['输入 tokens', fmtNum(inputTotal)],
    ['输出 tokens', fmtNum(stats.outputTokens)],
  ]

  const grid = cells.map(([k, v]) => `<div class="cell"><span class="k">${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('\n')

  const head = window !== undefined
    ? `上下文占用 <b>${fmtNum(c.total)}</b> / ${fmtNum(window)}${pct !== null ? ` (${pct}%)` : ''}`
    : `上下文占用（估算） <b>${fmtNum(c.total)}</b>`

  const segments = CONTEXT_CATS
    .filter((cat) => c[cat.key] > 0)
    .map((cat) => {
      const w = scale > 0 ? (c[cat.key] / scale * 100).toFixed(2) : '0'
      return `<span class="seg" style="width:${w}%;background:${cat.color}" title="${escapeHtml(cat.label)} ${fmtNum(c[cat.key])}"></span>`
    })
    .join('')

  const legend = CONTEXT_CATS
    .filter((cat) => c[cat.key] > 0)
    .map((cat) => {
      const share = c.total > 0 ? Math.round(c[cat.key] / c.total * 100) : 0
      return `<span class="lg"><i style="background:${cat.color}"></i>${escapeHtml(cat.label)} <b>${fmtNum(c[cat.key])}</b> ${share}%</span>`
    })
    .join('')

  const model = stats.model !== undefined
    ? `<div class="ctx-sub">${escapeHtml(stats.model)}${stats.provider !== undefined ? ` · ${escapeHtml(stats.provider)}` : ''}</div>`
    : ''

  return `<section class="stats">
  <div class="grid">${grid}</div>
  <div class="ctx">
    <div class="ctx-head">${head}</div>
    <div class="bar">${segments}</div>
    <div class="legend">${legend}</div>
    ${model}
  </div>
</section>`
}

export interface SharePageData {
  /**
   * Keep the machine-facing parts (tool calls, injected context, stats). When
   * false the page is just prompts and answers, and nothing auto-folds.
   */
  technical?: boolean
  title: string
  createdAt: number
  expiresAt?: number
  entries: TranscriptEntry[]
  stats?: ShareStats
  /** Number of secret patterns redacted when the snapshot was frozen. */
  redactedCount?: number
  /**
   * Events skipped because their type is outside the session-format vocabulary
   * this build renders. Present only when the snapshot may be incomplete.
   */
  unsupportedEvents?: { count: number; types: string[] }
}

export function renderShareHtml(data: SharePageData): string {
  const technical = data.technical !== false
  const body = data.entries.length > 0
    ? renderEntries(data.entries, technical)
    : `<div class="empty">此会话还没有可分享的对话内容。</div>`
  const expiry = data.expiresAt !== undefined
    ? `<div class="meta">链接过期时间：${fmtTime(data.expiresAt)}</div>`
    : ''
  const redacted = data.redactedCount !== undefined && data.redactedCount > 0
    ? ` · <span class="redacted">已脱敏 ${data.redactedCount} 处</span>`
    : ''
  // A session written by an unknown format is not an error — the page simply
  // shows less than it should. Say so, rather than letting a short page read
  // as an empty conversation.
  const unsupported = data.unsupportedEvents !== undefined && data.unsupportedEvents.count > 0
    ? `<div class="notice">此分享的部分内容使用了较新的会话格式（${data.unsupportedEvents.count} 条记录未渲染），可能显示不完整。</div>`
    : ''
  const stats = data.stats !== undefined ? statsHtml(data.stats) : ''

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(data.title)} · dsh-share</title>
<style>
  /*
   * Styling mirrors the harness chat itself: the same font stack, the same
   * neutral-bluish palette, and the same message geometry (a right-aligned
   * 20px-radius user bubble on the brand tint, plain full-width text for the
   * answer, one 680px content column).
   *
   * Values are the harness design tokens, resolved: a share page is served by
   * this plugin's own server and cannot reach the GUI's stylesheet, so the
   * token VALUES are inlined here rather than referenced. Light values come
   * from the token block's first definition, dark from its second.
   */
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --fg: #0f1115;
    --fg-secondary: #61666b;
    --fg-tertiary: #81858c;
    --border-soft: rgba(0, 0, 0, .06);
    --border: rgba(0, 0, 0, .10);
    --surface-2: #f9fafb;
    --user-bg: #edf3fe;
    --user-fg: #0f1115;
    --code-bg: rgba(0, 0, 0, .06);
    --link: #4176e6;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #232324;
      --fg: #f9fafb;
      --fg-secondary: #cfd3d6;
      --fg-tertiary: #adb2b8;
      --border-soft: rgba(255, 255, 255, .07);
      --border: rgba(255, 255, 255, .12);
      --surface-2: #353638;
      --user-bg: #34415b;
      --user-fg: #f9fafb;
      --code-bg: rgba(255, 255, 255, .08);
      --link: #7aaaff;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font-family: var(--font); font-size: 14px; line-height: 22px;
    -webkit-text-size-adjust: 100%;
  }
  header {
    position: sticky; top: 0; z-index: 10; background: var(--bg);
    border-bottom: 1px solid var(--border-soft); padding: 12px 32px;
  }
  header h1 { margin: 0; font-size: 15px; font-weight: 600; }
  header .meta { margin-top: 2px; font-size: 12px; color: var(--fg-secondary); }
  header .redacted { color: #b45309; }
  @media (prefers-color-scheme: dark) { header .redacted { color: #fbbf24; } }
  .notice { margin: 0 0 16px; padding: 10px 12px; border: 1px solid #fcd34d; border-radius: 10px; background: #fffbeb; color: #92400e; font-size: 13px; line-height: 1.5; }
  @media (prefers-color-scheme: dark) { .notice { border-color: #78350f; background: #2a1f0a; color: #fcd34d; } }
  main { max-width: 680px; margin: 0 auto; padding: 20px 32px 64px; }

  .row { display: flex; flex-direction: column; margin: 0 0 16px; }
  .row .time { font-size: 11px; color: var(--fg-secondary); margin: 4px 4px 0; }
  .row.user { align-items: flex-end; }
  .row.user .time { text-align: right; }

  /* The answer: plain, full width, no bubble — exactly how the chat shows it. */
  .answer { width: 100%; word-break: break-word; }
  .row.assistant .time { margin-top: 6px; }

  /* The prompt: right-aligned brand-tinted bubble. */
  .bubble {
    background: var(--user-bg); color: var(--user-fg);
    border-radius: 20px; padding: 10px 16px;
    max-width: min(477px, 82%); word-break: break-word;
  }
  .row.tool .bubble, .row.context .bubble {
    align-self: flex-start; max-width: 82%;
    background: var(--surface-2); color: var(--fg-secondary);
    border: 1px solid var(--border-soft); border-radius: 12px;
    padding: 8px 12px; font-size: 13px;
  }
  .bubble > :first-child, .answer > :first-child { margin-top: 0; }
  .bubble > :last-child, .answer > :last-child { margin-bottom: 0; }
  .bubble p, .answer p { margin: 0 0 10px; }
  .bubble h1, .bubble h2, .bubble h3, .bubble h4, .bubble h5, .bubble h6,
  .answer h1, .answer h2, .answer h3, .answer h4, .answer h5, .answer h6 { margin: 16px 0 8px; line-height: 1.35; font-weight: 600; }
  .bubble h1, .answer h1 { font-size: 19px; }
  .bubble h2, .answer h2 { font-size: 17px; }
  .bubble h3, .answer h3 { font-size: 15px; }
  .bubble h4, .bubble h5, .bubble h6,
  .answer h4, .answer h5, .answer h6 { font-size: 14px; }
  .bubble ul, .bubble ol, .answer ul, .answer ol { margin: 0 0 10px; padding-left: 22px; }
  .bubble li, .answer li { margin: 3px 0; }
  .bubble blockquote, .answer blockquote {
    margin: 10px 0; padding: 2px 12px; border-left: 3px solid var(--border);
    color: var(--fg-secondary);
  }
  .bubble pre, .answer pre {
    background: var(--surface-2); border: 1px solid var(--border-soft); border-radius: 8px;
    padding: 10px 12px; overflow-x: auto; margin: 10px 0;
  }
  .bubble pre code, .answer pre code { background: none; padding: 0; }
  .bubble code, .answer code {
    font-family: var(--mono); font-size: 13px;
    background: var(--code-bg); padding: 1px 5px; border-radius: 4px;
  }
  .bubble a, .answer a { color: var(--link); }
  .bubble hr, .answer hr { border: none; border-top: 1px solid var(--border-soft); margin: 14px 0; }
  .bubble table, .answer table { border-collapse: collapse; margin: 10px 0; width: 100%; }
  .bubble th, .bubble td, .answer th, .answer td { border: 1px solid var(--border-soft); padding: 6px 10px; text-align: left; }
  .bubble th, .answer th { background: var(--surface-2); }
  .bubble img, .answer img { max-width: 100%; }
  .bubble del, .answer del { color: var(--fg-tertiary); }

  .fold summary { cursor: pointer; list-style: none; display: flex; align-items: baseline; gap: 8px; }
  .fold summary::-webkit-details-marker { display: none; }
  .fold summary::marker { content: ''; }
  /* The preview keeps the message's line structure. */
  .fold .preview { flex: 1; min-width: 0; white-space: pre-wrap; }
  .fold .toggle { flex: none; color: var(--fg-tertiary); font-size: 12px; white-space: nowrap; }
  .fold .toggle::after { content: '展开全文'; }
  .fold[open] .toggle::after { content: '收起'; }
  .fold[open] .preview { display: none; }
  .fold .full { word-break: break-word; margin-top: 6px; }

  .toolrun {
    border: 1px solid var(--border-soft); border-radius: 12px; padding: 8px 12px;
    background: var(--surface-2); max-width: 82%; align-self: flex-start;
  }
  .toolrun summary { cursor: pointer; list-style: none; display: flex; align-items: baseline; gap: 8px; }
  .toolrun summary::-webkit-details-marker { display: none; }
  .toolrun summary::marker { content: ''; }
  .toolrun .tl { flex: 1; min-width: 0; color: var(--fg-secondary); font-size: 13px; }
  .toolrun .tl code { font-size: 12px; }
  .toolrun .toggle { flex: none; color: var(--fg-tertiary); font-size: 12px; white-space: nowrap; }
  .toolrun .toggle::after { content: '展开'; }
  .toolrun[open] .toggle::after { content: '收起'; }
  .toolrun-body { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .trow { font-size: 12px; color: var(--fg-secondary); display: flex; gap: 8px; align-items: baseline; }
  .trow .ttime { color: var(--fg-tertiary); flex: none; }
  .tool code, .trow code { font-family: var(--mono); font-size: 12px; }

  .stats {
    background: var(--surface-2); border: 1px solid var(--border-soft); border-radius: 14px;
    padding: 16px; margin-bottom: 20px;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px 14px; margin-bottom: 14px; }
  .cell { display: flex; flex-direction: column; gap: 2px; }
  .cell .k { font-size: 11px; color: var(--fg-secondary); }
  .cell b { font-size: 16px; font-weight: 600; color: var(--fg); }
  .ctx-head { font-size: 13px; color: var(--fg-secondary); margin-bottom: 6px; }
  .ctx-head b { color: var(--fg); }
  .ctx-sub { font-size: 11px; color: var(--fg-secondary); margin-top: 6px; }
  .bar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: var(--border-soft); gap: 1px; }
  .seg { height: 100%; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 12px; color: var(--fg-secondary); }
  .legend .lg { display: inline-flex; align-items: center; gap: 5px; }
  .legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .legend b { color: var(--fg); font-weight: 600; }

  .empty { color: var(--fg-secondary); padding: 24px 0; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(data.title)}</h1>
  <div class="meta">会话快照 · ${fmtTime(data.createdAt)}${expiry ? ' · ' + expiry : ''}${redacted}</div>
  ${unsupported}
</header>
<main>
${stats}
${body}
</main>
<footer>由 dsh-share 生成 · 只读快照</footer>
</body>
</html>`
}
