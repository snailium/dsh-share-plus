/**
 * Best-effort secret redaction for share snapshots.
 *
 * Redaction is pattern matching, NOT a guarantee: it masks the common shapes of
 * credentials and local-infrastructure details so a published snapshot is safe
 * by default, but novel or obfuscated secrets can slip through — review the
 * artifact before sharing. The rules are ordered (specific multi-line blocks
 * first, single-line token patterns after) and applied in one pass per class,
 * with zero runtime dependencies.
 *
 * Design constraints:
 *   - never log the original value anywhere;
 *   - report the replacement count so the UI can prove the feature fired;
 *   - per-class toggles so a user can keep e.g. emails.
 */

export type RedactClass =
  | 'privateKey'      // -----BEGIN ... PRIVATE KEY----- blocks (multi-line)
  | 'jwt'             // eyJ...eyJ... three dot-separated b64url segments
  | 'cloudKeys'       // sk-..., AKIA[0-9A-Z]{16}, ghp_, github_pat_
  | 'urlCredentials'  // scheme://user:pass@host
  | 'envAssignment'   // KEY=value for secret-looking keys, plus bare token=...
  | 'localPaths'      // /home/<user>/..., C:\Users\<user>\...
  | 'privateIps'      // 10.x, 172.16-31.x, 192.168.x
  | 'emails'          // local@domain (off by default)

export interface RedactOptions {
  /** Master switch; callers default it to ON. */
  enabled: boolean
  /** Per-class toggles so a user can keep e.g. emails. Default: all on except emails. */
  classes?: Partial<Record<RedactClass, boolean>>
  /** Replacement text. Default '«REDACTED»'. */
  replacement?: string
}

export interface RedactResult {
  text: string
  count: number
}

const DEFAULT_CLASSES: Record<RedactClass, boolean> = {
  privateKey: true,
  jwt: true,
  cloudKeys: true,
  urlCredentials: true,
  envAssignment: true,
  localPaths: true,
  privateIps: true,
  emails: false,
}

const SECRET_KEY = '(?:[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*)'

/** Ordered rule list: earlier rules win (a JWT contains 'eyJ'; a key block spans newlines). */
const RULES: { cls: RedactClass; re: RegExp }[] = [
  // The `|$` alternative is load-bearing: a TRUNCATED key block — one whose
  // `-----END ...-----` line never arrived, because the session was trimmed or
  // the tool output was cut — still leaks the key material if the rule only
  // matches well-formed blocks. An unterminated block therefore redacts to the
  // end of the text.
  { cls: 'privateKey', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g },
  // A JWT's first segment is base64url of `{"…`, i.e. it always begins `eyJ`.
  // Anchoring on that keeps ordinary dotted names (`file.tar.gz`) intact.
  { cls: 'jwt', re: /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { cls: 'cloudKeys', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { cls: 'cloudKeys', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { cls: 'cloudKeys', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { cls: 'cloudKeys', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { cls: 'urlCredentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\/\s:@]+:[^@\s/]+@/gi },
  { cls: 'envAssignment', re: new RegExp(`(?<![A-Za-z0-9_])${SECRET_KEY}\\s*[=:]\\s*\\S+`, 'g') },
  { cls: 'envAssignment', re: /\b(?:token|api_key|apikey|secret|password|passwd)\s*[=:]\s*\S+/gi },
  { cls: 'localPaths', re: /\/home\/[A-Za-z0-9._-]+(?:\/[^\s"'`<>)\]]+)*\//g },
  { cls: 'localPaths', re: /\/Users\/[A-Za-z0-9._-]+(?:\/[^\s"'`<>)\]]+)*\//g },
  { cls: 'localPaths', re: /\b[A-Za-z]:\\(?:Users|home)\\[^\s"'`<>)\]]+/gi },
  { cls: 'privateIps', re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g },
  { cls: 'emails', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
]

function resolveClasses(opts: RedactOptions): Record<RedactClass, boolean> {
  const out = { ...DEFAULT_CLASSES }
  for (const [k, v] of Object.entries(opts.classes ?? {})) {
    if (v !== undefined) out[k as RedactClass] = v
  }
  return out
}

/**
 * Redact one text value. Returns the masked text plus the number of
 * replacements performed (0 when redaction is disabled or nothing matched).
 */
export function redactText(text: string, opts: RedactOptions): RedactResult {
  if (!opts.enabled || text === '') return { text, count: 0 }
  const classes = resolveClasses(opts)
  const replacement = opts.replacement ?? '«REDACTED»'
  let out = text
  let count = 0
  for (const rule of RULES) {
    if (!classes[rule.cls]) continue
    out = out.replace(rule.re, () => {
      count += 1
      return replacement
    })
  }
  return { text: out, count }
}
