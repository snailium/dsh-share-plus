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

/**
 * Render message text, auto-folding long messages behind a native
 * `<details>`/`<summary>` disclosure (no JavaScript — stays XSS-safe). Short
 * messages render inline; long ones show a single-line preview with an
 * 展开全文/收起 toggle.
 */
function renderText(text: string): string {
  if (text.length <= FOLD_THRESHOLD) return renderMarkdown(text)
  const oneLine = text.replace(/\s+/g, ' ').trim()
  const previewText = oneLine.length > PREVIEW_LENGTH ? oneLine.slice(0, PREVIEW_LENGTH) + '…' : oneLine
  return `<details class="fold"><summary><span class="preview">${escapeHtml(previewText)}</span><span class="toggle"></span></summary><div class="full">${renderMarkdown(text)}</div></details>`
}

function entryHtml(e: TranscriptEntry): string {
  const time = e.time !== undefined ? `<div class="time">${fmtTime(e.time)}</div>` : ''
  if (e.role === 'tool') {
    if (e.calls !== undefined && e.calls.length > 0) {
      return `<div class="row tool">${time}<div class="bubble">🔧 调用工具 · <code>${escapeHtml(e.calls.join(', '))}</code></div></div>`
    }
    return `<div class="row tool">${time}<div class="bubble">↩ 工具结果${e.tool !== undefined ? ` · <code>${escapeHtml(e.tool)}</code>` : ''}</div></div>`
  }
  if (e.role === 'context') {
    return `<div class="row context">${time}<div class="bubble">${renderText(e.text)}</div></div>`
  }
  if (e.role === 'assistant') {
    return `<div class="row assistant">${time}<div class="bubble">${renderText(e.text)}</div></div>`
  }
  return `<div class="row user">${time}<div class="bubble">${renderText(e.text)}</div></div>`
}

function toolLine(e: TranscriptEntry): string {
  const time = e.time !== undefined ? `<span class="ttime">${fmtTime(e.time)}</span>` : ''
  const body = e.calls !== undefined && e.calls.length > 0
    ? `🔧 调用工具 · <code>${escapeHtml(e.calls.join(', '))}</code>`
    : `↩ 工具结果${e.tool !== undefined ? ` · <code>${escapeHtml(e.tool)}</code>` : ''}`
  return `<div class="trow">${time}${body}</div>`
}

/** Group a run of consecutive tool entries into one collapsible disclosure. */
function renderToolRun(run: TranscriptEntry[]): string {
  if (run.length === 1) return entryHtml(run[0])
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
function renderEntries(entries: TranscriptEntry[]): string {
  const out: string[] = []
  let run: TranscriptEntry[] = []
  const flush = (): void => {
    if (run.length === 0) return
    out.push(renderToolRun(run))
    run = []
  }
  for (const e of entries) {
    if (e.role === 'tool') { run.push(e); continue }
    flush()
    out.push(entryHtml(e))
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
  title: string
  createdAt: number
  expiresAt?: number
  entries: TranscriptEntry[]
  stats?: ShareStats
}

export function renderShareHtml(data: SharePageData): string {
  const body = data.entries.length > 0
    ? renderEntries(data.entries)
    : `<div class="empty">此会话还没有可分享的对话内容。</div>`
  const expiry = data.expiresAt !== undefined
    ? `<div class="meta">链接过期时间：${fmtTime(data.expiresAt)}</div>`
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
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #f6f7f9; color: #1c1e21;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #14161a; color: #e4e6eb; }
    .bubble { background: #1e2127; }
    .row.user .bubble { background: #20304a; }
    .row.tool .bubble, .row.context .bubble { background: #23201a; color: #a8a29e; }
    .toolrun { background: #23201a; border-color: #2c2f36; }
    .toolrun .tl, .toolrun .trow { color: #a8a29e; }
    .bubble blockquote { border-color: #3a3d43; color: #a8a29e; }
    .bubble pre { background: #14161a; border-color: #2c2f36; }
    .bubble code { background: rgba(255,255,255,.08); }
    .bubble a { color: #7aa2f7; }
    .bubble hr { border-color: #2c2f36; }
    .bubble th, .bubble td { border-color: #2c2f36; }
    .bubble th { background: #1e2127; }
    header { background: #1a1c21; border-color: #2c2f36; }
    .stats { background: #1a1c21; border-color: #2c2f36; }
    .cell b { color: #e4e6eb; }
  }
  header {
    position: sticky; top: 0; z-index: 10; background: #fff; border-bottom: 1px solid #e5e7eb;
    padding: 14px 20px; box-shadow: 0 1px 2px rgba(0,0,0,.03);
  }
  header h1 { margin: 0; font-size: 17px; font-weight: 600; }
  header .meta { margin-top: 4px; font-size: 12px; color: #8a8f98; }
  main { max-width: 820px; margin: 0 auto; padding: 20px 16px 48px; }

  .stats {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 14px;
    padding: 16px; margin-bottom: 20px;
  }
  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px 14px; margin-bottom: 14px;
  }
  .cell { display: flex; flex-direction: column; gap: 2px; }
  .cell .k { font-size: 11px; color: #8a8f98; }
  .cell b { font-size: 16px; font-weight: 600; }
  .ctx-head { font-size: 13px; color: #5f6368; margin-bottom: 6px; }
  .ctx-head b { color: #1c1e21; }
  .ctx-sub { font-size: 11px; color: #8a8f98; margin-top: 6px; }
  .bar {
    display: flex; height: 12px; border-radius: 6px; overflow: hidden;
    background: #eef0f3; gap: 1px;
  }
  @media (prefers-color-scheme: dark) { .bar { background: #2a2d33; } }
  .seg { height: 100%; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 12px; color: #5f6368; }
  .legend .lg { display: inline-flex; align-items: center; gap: 5px; }
  .legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .legend b { color: #1c1e21; font-weight: 600; }
  @media (prefers-color-scheme: dark) { .legend b { color: #e4e6eb; } }

  .row { display: flex; flex-direction: column; margin: 14px 0; }
  .row .time { font-size: 11px; color: #9aa0a8; margin: 0 4px 4px; }
  .bubble {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
    padding: 10px 14px; max-width: 92%; word-break: break-word;
  }
  .bubble > :first-child { margin-top: 0; }
  .bubble > :last-child { margin-bottom: 0; }
  .bubble p { margin: 0 0 8px; }
  .bubble h1, .bubble h2, .bubble h3, .bubble h4, .bubble h5, .bubble h6 { margin: 12px 0 6px; line-height: 1.3; }
  .bubble h1 { font-size: 20px; } .bubble h2 { font-size: 18px; } .bubble h3 { font-size: 16px; }
  .bubble h4 { font-size: 15px; } .bubble h5, .bubble h6 { font-size: 14px; }
  .bubble ul, .bubble ol { margin: 0 0 8px; padding-left: 22px; }
  .bubble li { margin: 2px 0; }
  .bubble blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid #d0d4da; color: #5f6368; }
  .bubble pre {
    background: #f0f2f5; border: 1px solid #e5e7eb; border-radius: 8px;
    padding: 10px 12px; overflow-x: auto; margin: 8px 0;
  }
  .bubble pre code { background: none; padding: 0; }
  .bubble code {
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 13px;
    background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 4px;
  }
  .bubble a { color: #2563eb; }
  .bubble hr { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }
  .bubble table { border-collapse: collapse; margin: 8px 0; width: 100%; }
  .bubble th, .bubble td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; }
  .bubble th { background: #f0f2f5; }
  .bubble img { max-width: 100%; }
  .bubble del { color: #8a8f98; }
  .row.user .bubble { background: #e8f1ff; border-color: #d3e3ff; align-self: flex-start; }
  .row.assistant .bubble { align-self: flex-end; }
  .row.tool .bubble, .row.context .bubble {
    background: #faf8f2; border-color: #ece7da; color: #8a8276; font-size: 13px;
    align-self: flex-start; max-width: 88%;
  }
  .row.tool code { font-size: 12px; }
  code { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }

  .fold summary { cursor: pointer; list-style: none; display: flex; align-items: baseline; gap: 8px; }
  .fold summary::-webkit-details-marker { display: none; }
  .fold summary::marker { content: ''; }
  .fold .preview { flex: 1; min-width: 0; }
  .fold .toggle { flex: none; color: #8a8f98; font-size: 12px; white-space: nowrap; }
  .fold .toggle::after { content: '展开全文'; }
  .fold[open] .toggle::after { content: '收起'; }
  .fold[open] .preview { display: none; }
  .fold .full { word-break: break-word; margin-top: 6px; }

  .toolrun {
    border: 1px solid #ece7da; border-radius: 10px; padding: 8px 12px;
    background: #faf8f2; max-width: 88%;
  }
  .toolrun summary { cursor: pointer; list-style: none; display: flex; align-items: baseline; gap: 8px; }
  .toolrun summary::-webkit-details-marker { display: none; }
  .toolrun summary::marker { content: ''; }
  .toolrun .tl { flex: 1; min-width: 0; color: #8a8276; font-size: 13px; }
  .toolrun .tl code { font-size: 12px; }
  .toolrun .toggle { flex: none; color: #8a8f98; font-size: 12px; white-space: nowrap; }
  .toolrun .toggle::after { content: '展开'; }
  .toolrun[open] .toggle::after { content: '收起'; }
  .toolrun-body { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
  .trow { font-size: 13px; color: #8a8276; }
  .trow code { font-size: 12px; }
  .ttime { font-size: 11px; color: #9aa0a8; margin-right: 6px; }

  .empty { text-align: center; color: #9aa0a8; padding: 60px 0; }
  footer { text-align: center; color: #b3b8c0; font-size: 12px; padding: 20px 0; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(data.title)}</h1>
  <div class="meta">会话快照 · ${fmtTime(data.createdAt)}${expiry ? ' · ' + expiry : ''}</div>
</header>
<main>
${stats}
${body}
</main>
<footer>由 dsh-share 生成 · 只读快照</footer>
</body>
</html>`
}
