/**
 * Directory listing and landing pages for directory mounts.
 *
 * Server-rendered HTML with no JavaScript and no external assets, matching the
 * session share page. Every dynamic string is escaped; the pages carry a
 * restrictive CSP because a shared directory can contain files whose names are
 * attacker-influenced (a build artifact named after a branch, say).
 *
 * Symlinked entries are resolved and dropped when they leave the mount, so the
 * listing never advertises a path the server would refuse to serve.
 */

import { opendir, realpath, stat } from 'node:fs/promises'
import { isContained, type Mount } from './mounts'

/** One rendered row of a directory listing. */
export interface ListingEntry {
  name: string
  isDir: boolean
  size: number
  mtimeMs: number
}

/** Hard cap on rows rendered for one directory, so a huge dir cannot hang a page. */
const MAX_ENTRIES = 5000

/**
 * One shared collator for the whole process.
 *
 * `String.prototype.localeCompare(other, locale, options)` constructs an ICU
 * collator per call, so sorting thousands of names with it dominates the
 * response time of a large listing. A single `Intl.Collator` with numeric
 * ordering is dramatically cheaper and gives the same order.
 */
const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'variant' })

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Human-readable byte count. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Read one directory for rendering.
 *
 * The scan is streamed with `opendir` and stops at {@link MAX_ENTRIES}, so a
 * directory with a million entries costs the same as one with a thousand: an
 * eager `readdir` would materialise every entry (tens of MB of `Dirent`
 * objects for a large tree) before the cap could apply, once per request.
 *
 * Entries that are not regular files/directories, that are hidden while the
 * mount hides dotfiles, or that resolve outside the mount, are omitted.
 */
export async function readListing(mount: Mount, dirAbsolute: string): Promise<{ entries: ListingEntry[]; truncated: boolean }> {
  const entries: ListingEntry[] = []
  let truncated = false

  const dir = await opendir(dirAbsolute)
  try {
    for await (const dirent of dir) {
      if (entries.length >= MAX_ENTRIES) {
        truncated = true
        break
      }
      if (!mount.hidden && dirent.name.startsWith('.')) continue

      const child = `${dirAbsolute}${dirAbsolute.endsWith('/') ? '' : '/'}${dirent.name}`
      let resolved: string
      try {
        // Normalise the containment check through realpath even for non-links,
        // so a symlinked entry is judged by where it actually points.
        resolved = await realpath(child)
      } catch {
        continue
      }
      if (!isContained(mount.realRoot, resolved)) continue

      let st: Awaited<ReturnType<typeof stat>>
      try {
        st = await stat(resolved)
      } catch {
        continue
      }
      if (!st.isDirectory() && !st.isFile()) continue

      entries.push({
        name: dirent.name,
        isDir: st.isDirectory(),
        size: st.size,
        mtimeMs: st.mtimeMs,
      })
    }
  } finally {
    // Releases the directory handle even when the loop exits early.
    await dir.close().catch(() => {})
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return NAME_COLLATOR.compare(a.name, b.name)
  })
  return { entries, truncated }
}

const STYLES = `
:root{color-scheme:light dark;--fg:#1f2328;--muted:#656d76;--line:#d8dee4;--bg:#ffffff;--accent:#0969da;--hover:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--bg:#0d1117;--accent:#4493f8;--hover:#161b22}}
*{box-sizing:border-box}
body{margin:0;padding:32px 20px 64px;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:900px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px;word-break:break-all}
.crumb{color:var(--muted);font-size:13px;margin-bottom:20px;word-break:break-all}
.crumb a{color:var(--accent);text-decoration:none}
.crumb a:hover{text-decoration:underline}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
td.size,th.size{text-align:right;white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}
td.time,th.time{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}
a{color:var(--accent);text-decoration:none}
tr:hover td{background:var(--hover)}
.dir a{font-weight:600}
.empty{color:var(--muted);padding:24px 0}
.note{color:var(--muted);font-size:13px;margin-top:16px}
.mounts{list-style:none;padding:0;margin:0}
.mounts li{padding:12px 0;border-bottom:1px solid var(--line)}
.mounts a{font-weight:600;font-size:16px}
.mounts .sub{color:var(--muted);font-size:13px}
`

function page(title: string, body: string, extraCsp = ''): string {
  return `<!doctype html>
<html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head><body><main>${body}</main></body></html>`
}

/** CSP for our own server-rendered pages (inline styles only). */
export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

/** URL prefix for a mount, including its token segment when it has one. */
export function mountBasePath(mount: Mount): string {
  return mount.token === undefined ? `/${mount.name}` : `/${mount.name}/${mount.token}`
}

function encodePathSegments(segments: readonly string[]): string {
  return segments.map((s) => encodeURIComponent(s)).join('/')
}

/** Render the index page for one directory. */
export function renderListing(mount: Mount, segments: readonly string[], listing: { entries: ListingEntry[]; truncated: boolean }): string {
  const base = mountBasePath(mount)
  const location = `/${mount.name}${segments.length > 0 ? `/${segments.join('/')}` : ''}`

  const crumbs: string[] = [`<a href="${escapeHtml(base)}/">${escapeHtml(mount.name)}</a>`]
  let accumulated = base
  for (const segment of segments) {
    accumulated += `/${encodeURIComponent(segment)}`
    crumbs.push(`<a href="${escapeHtml(accumulated)}/">${escapeHtml(segment)}</a>`)
  }

  const rows: string[] = []
  if (segments.length > 0) {
    const parent = segments.slice(0, -1)
    const href = parent.length === 0 ? `${base}/` : `${base}/${encodePathSegments(parent)}/`
    rows.push(`<tr class="dir"><td><a href="${escapeHtml(href)}">../</a></td><td class="size"></td><td class="time"></td></tr>`)
  }
  for (const entry of listing.entries) {
    const href = `${base}/${encodePathSegments([...segments, entry.name])}${entry.isDir ? '/' : ''}`
    rows.push(
      `<tr class="${entry.isDir ? 'dir' : 'file'}">` +
        `<td><a href="${escapeHtml(href)}">${escapeHtml(entry.name)}${entry.isDir ? '/' : ''}</a></td>` +
        `<td class="size">${entry.isDir ? '' : escapeHtml(formatSize(entry.size))}</td>` +
        `<td class="time">${escapeHtml(formatTime(entry.mtimeMs))}</td>` +
        `</tr>`,
    )
  }

  const table = rows.length === 0
    ? `<p class="empty">该目录为空。</p>`
    : `<table><thead><tr><th>名称</th><th class="size">大小</th><th class="time">修改时间</th></tr></thead><tbody>${rows.join('')}</tbody></table>`

  const truncated = listing.truncated
    ? `<p class="note">目录条目过多，仅显示前 ${MAX_ENTRIES} 项。</p>`
    : ''

  return page(
    `${location} · ${mount.name}`,
    `<h1>${escapeHtml(mount.name)}</h1>` +
      `<div class="crumb">${crumbs.join(' / ')}</div>` +
      table +
      truncated +
      `<p class="note">只读目录分享 · ${escapeHtml(location)}</p>`,
  )
}

/** Render the landing page that lists the publicly reachable mounts. */
export function renderMountIndex(mounts: readonly Mount[]): string {
  // Token-protected mounts are deliberately absent: the landing page is
  // unauthenticated, so it must not advertise them (nor their tokens).
  const open = mounts.filter((m) => m.token === undefined)
  const items = open
    .map(
      (m) =>
        `<li><a href="${escapeHtml(`/${m.name}/`)}">${escapeHtml(m.name)}/</a>` +
        `<div class="sub">${escapeHtml(m.root)}</div></li>`,
    )
    .join('')
  const body = open.length === 0
    ? `<h1>目录分享</h1><p class="empty">当前没有公开目录。请在插件设置中添加，或为目录设置 token 后通过带 token 的地址访问。</p>`
    : `<h1>目录分享</h1><ul class="mounts">${items}</ul>`
  return page('目录分享', body)
}
