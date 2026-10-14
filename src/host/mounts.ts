/**
 * Directory mounts — mapping a URL prefix onto a local directory, safely.
 *
 * A mount turns `http://<host>:<port>/apk/…` into a read-only view of one
 * directory on disk (a build output folder, an APK drop, a log directory). It
 * is deliberately the *only* place in this plugin that touches arbitrary
 * filesystem paths, so all of the containment logic lives here:
 *
 *   1. **URL prefix is a name, never a path.** A mount's name is validated
 *      against a strict identifier pattern and may not collide with the
 *      reserved `/s/` session-share prefix.
 *   2. **Traversal is rejected, not normalised away.** A request path is split
 *      on `/` *first* and each segment is percent-decoded *after*; a segment
 *      that decodes to `.`, `..`, or anything containing a separator or a NUL
 *      byte is refused outright. Decoding before splitting is the classic
 *      `%2F` bypass, and normalising `..` instead of rejecting it is the
 *      classic prefix-confusion bypass.
 *   3. **Symlinks may not escape the mount.** The candidate path is resolved
 *      with `realpath` and the *result* is re-checked against the mount's own
 *      `realpath`. A symlink pointing outside the mount is denied, so a shared
 *      directory cannot be used as a pivot into the rest of the filesystem.
 *   4. **Dotfiles are hidden by default.** Build directories routinely contain
 *      `.env`, `.gradle/`, keystores and CI credentials. Those are refused
 *      unless the mount explicitly opts in with `hidden: true`.
 *   5. **Only regular files and directories are served.** Sockets, FIFOs and
 *      device nodes are denied.
 *
 * Everything here is read-only: nothing in this module writes, creates, or
 * unlinks anything.
 */

import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** A mount as written in configuration. */
export interface MountSpec {
  /** URL prefix, e.g. `apk` for `/<...>/apk/`. */
  name: string
  /** Local directory to expose. */
  path: string
  /** When non-empty, the URL becomes `/<name>/<token>/…`. */
  token?: string
  /** Render a browsable directory listing. Default true. */
  index?: boolean
  /** Serve dotfiles. Default false — they routinely hold credentials. */
  hidden?: boolean
}

/** A mount that passed validation and whose root exists on disk. */
export interface Mount {
  name: string
  /** Absolute root as configured. */
  root: string
  /** `realpath` of the root, used for the symlink-escape check. */
  realRoot: string
  token: string | undefined
  index: boolean
  hidden: boolean
}

/** Why a configured mount is not being served. */
export interface MountProblem {
  name: string
  path: string
  reason: string
}

export interface ResolvedMounts {
  mounts: Mount[]
  problems: MountProblem[]
}

/** URL prefixes this plugin owns; a mount may not shadow them. */
export const RESERVED_NAMES = new Set(['s', 'favicon.ico', 'robots.txt'])

const MOUNT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * Request-target limits.
 *
 * The HTTP layer already refuses an over-long request line (Node answers 431
 * once headers exceed `maxHeaderSize`), but these are enforced independently:
 * they bound the work this module does per request, so raising or losing the
 * transport limit cannot turn into an unbounded path walk. A path deeper or
 * longer than any real filesystem entry is refused rather than resolved.
 */
export const MAX_PATH_SEGMENTS = 128
/** ext4/APFS/NTFS cap a single name at 255 bytes; longer cannot exist on disk. */
export const MAX_SEGMENT_LENGTH = 255

/** Validate a mount name. Returns an error message, or null when acceptable.
 * Names become URL path segments, so this is an allow-list, never a sanitizer.
 */
export function validateMountName(name: string): string | null {
  if (name === '') return 'name is empty'
  if (!MOUNT_NAME_RE.test(name)) {
    return 'name must start with a letter or digit and contain only letters, digits, ".", "_" or "-"'
  }
  if (RESERVED_NAMES.has(name)) return `name "${name}" is reserved by the plugin`
  if (name.includes('..')) return 'name must not contain ".."'
  return null
}

/** Outcome of decoding a request path into segments. */
export type SegmentResult =
  | { ok: true; segments: string[] }
  /** Structurally unsafe (traversal, separator, NUL, bad encoding). */
  | { ok: false; reason: 'unsafe' }
  /** Well-formed but beyond the limits above. */
  | { ok: false; reason: 'too-long' }

/** Decode a request path into safe segments, or say why it must be refused. */
export function decodeSegments(urlPath: string): SegmentResult {
  const out: string[] = []
  for (const raw of urlPath.split('/')) {
    if (raw === '' || raw === '.') continue
    let segment: string
    try {
      segment = decodeURIComponent(raw)
    } catch {
      return { ok: false, reason: 'unsafe' } // malformed percent-encoding
    }
    if (segment === '' || segment === '.') continue
    // Rejected outright rather than normalised — see the module comment.
    if (segment === '..') return { ok: false, reason: 'unsafe' }
    if (segment.includes('/') || segment.includes('\\') || segment.includes('\0')) {
      return { ok: false, reason: 'unsafe' }
    }
    // A bare drive spec would re-root the join on Windows.
    if (/^[A-Za-z]:$/.test(segment)) return { ok: false, reason: 'unsafe' }
    if (segment.length > MAX_SEGMENT_LENGTH) return { ok: false, reason: 'too-long' }
    if (out.length >= MAX_PATH_SEGMENTS) return { ok: false, reason: 'too-long' }
    out.push(segment)
  }
  return { ok: true, segments: out }
}

/** Whether `child` is `parent` itself or lies underneath it. */
export function isContained(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  if (rel === '') return true
  if (rel.startsWith('..')) return false
  if (isAbsolute(rel)) return false
  return !rel.split(sep).includes('..')
}

function isHiddenSegment(segment: string): boolean {
  return segment.startsWith('.') && segment !== '.' && segment !== '..'
}

/**
 * Resolve configured specs into servable mounts.
 *
 * Invalid specs are reported, never thrown: one bad mount must not stop the
 * share server from coming up, and the settings card renders the reasons.
 */
export async function resolveMounts(specs: readonly MountSpec[]): Promise<ResolvedMounts> {
  const mounts: Mount[] = []
  const problems: MountProblem[] = []
  const seen = new Set<string>()

  for (const spec of specs) {
    const name = typeof spec.name === 'string' ? spec.name : ''
    const rawPath = typeof spec.path === 'string' ? spec.path : ''

    const nameError = validateMountName(name)
    if (nameError !== null) {
      problems.push({ name, path: rawPath, reason: nameError })
      continue
    }
    if (seen.has(name)) {
      problems.push({ name, path: rawPath, reason: 'duplicate mount name' })
      continue
    }
    seen.add(name)

    if (rawPath.trim() === '') {
      problems.push({ name, path: rawPath, reason: 'path is empty' })
      continue
    }

    const root = resolve(rawPath)
    let realRoot: string
    try {
      realRoot = await realpath(root)
    } catch {
      problems.push({ name, path: root, reason: 'path does not exist' })
      continue
    }
    try {
      const st = await stat(realRoot)
      if (!st.isDirectory()) {
        problems.push({ name, path: root, reason: 'path is not a directory' })
        continue
      }
    } catch {
      problems.push({ name, path: root, reason: 'path is not readable' })
      continue
    }

    const token = typeof spec.token === 'string' && spec.token.trim() !== '' ? spec.token.trim() : undefined
    mounts.push({
      name,
      root,
      realRoot,
      token,
      index: spec.index !== false,
      hidden: spec.hidden === true,
    })
  }

  return { mounts, problems }
}

/** What a request path resolved to inside a mount. */
export type MountLookup =
  | { kind: 'file'; absolute: string; basename: string; size: number; mtimeMs: number }
  | { kind: 'dir'; absolute: string; segments: string[] }
  | { kind: 'denied'; reason: string }
  | { kind: 'missing' }
  /** Well-formed but beyond the request-target limits (answered as 414). */
  | { kind: 'too-long'; reason: string }

/**
 * Resolve a request path inside one mount.
 *
 * `urlPath` is the path *below* the mount (and below the token, when the mount
 * has one), still percent-encoded as it arrived.
 */
export async function lookupInMount(mount: Mount, urlPath: string): Promise<MountLookup> {
  const decoded = decodeSegments(urlPath)
  if (!decoded.ok) {
    return decoded.reason === 'too-long'
      ? { kind: 'too-long', reason: 'path exceeds the request-target limits' }
      : { kind: 'denied', reason: 'unsafe path' }
  }
  const segments = decoded.segments
  if (!mount.hidden && segments.some(isHiddenSegment)) {
    return { kind: 'denied', reason: 'hidden path' }
  }

  const candidate = join(mount.root, ...segments)
  if (!isContained(mount.root, candidate)) return { kind: 'denied', reason: 'escapes mount root' }

  let real: string
  try {
    real = await realpath(candidate)
  } catch {
    return { kind: 'missing' }
  }
  // A symlink inside the mount must not become a pivot out of it.
  if (!isContained(mount.realRoot, real)) return { kind: 'denied', reason: 'symlink escapes mount root' }

  let st: Awaited<ReturnType<typeof stat>>
  try {
    st = await stat(real)
  } catch {
    return { kind: 'missing' }
  }

  if (st.isDirectory()) return { kind: 'dir', absolute: real, segments }
  if (st.isFile()) {
    return {
      kind: 'file',
      absolute: real,
      basename: segments.length > 0 ? segments[segments.length - 1]! : mount.name,
      size: st.size,
      mtimeMs: st.mtimeMs,
    }
  }
  // Sockets, FIFOs, block/character devices are not shareable content.
  return { kind: 'denied', reason: 'not a regular file' }
}
