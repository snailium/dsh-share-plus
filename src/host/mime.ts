/**
 * Content types for the directory-mount file server.
 *
 * Two decisions embedded here matter for safety and for the Android use case:
 *
 *   - `.apk` maps to the Android package MIME type, so a phone that opens the
 *     link offers to install rather than showing a download blob.
 *   - Types the browser would execute on our own origin (HTML, SVG, XML) are
 *     never served inline. The share server also hosts token-guarded session
 *     pages, and running attacker-authored markup on that origin is a needless
 *     risk, so those are forced to download as opaque bytes.
 */

/** Extension → MIME type for the types a shared build directory actually holds. */
const BY_EXTENSION: Record<string, string> = {
  // Mobile artifacts — the reason this server grew a file mode.
  apk: 'application/vnd.android.package-archive',
  aab: 'application/octet-stream',
  ipa: 'application/octet-stream',
  xapk: 'application/octet-stream',
  dex: 'application/octet-stream',

  // Archives
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  tar: 'application/x-tar',
  bz2: 'application/x-bzip2',
  xz: 'application/x-xz',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',

  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',

  // Audio / video
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',

  // Documents
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',

  // Fonts & misc
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  bin: 'application/octet-stream',
}

/**
 * Types served inline. Everything else — including every unknown extension —
 * is sent as an attachment, which is also the safe default: an unknown type is
 * never rendered by the browser on this origin.
 */
const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
  'image/x-icon', 'image/avif',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
  'video/mp4', 'video/webm', 'video/x-matroska',
  'application/pdf',
  'text/plain; charset=utf-8', 'text/csv; charset=utf-8',
  'text/tab-separated-values; charset=utf-8',
  'application/json; charset=utf-8',
])

/** Lowercased extension of a basename (no dot), or '' when there is none. */
export function extensionOf(basename: string): string {
  const at = basename.lastIndexOf('.')
  if (at <= 0 || at === basename.length - 1) return ''
  return basename.slice(at + 1).toLowerCase()
}

/** MIME type for a basename; unknown extensions become opaque bytes. */
export function contentTypeOf(basename: string): string {
  return BY_EXTENSION[extensionOf(basename)] ?? 'application/octet-stream'
}

/** Whether a type may be rendered in the browser rather than downloaded. */
export function isInlineType(contentType: string): boolean {
  return INLINE_TYPES.has(contentType)
}
