/**
 * ShareStore — the token→snapshot registry, persisted as a JSON file so shares
 * survive a harness restart. The transcript is stored alongside the metadata,
 * so a share stays a TRUE frozen snapshot (opening it later never re-reads a
 * session that may have grown or been deleted). Expired shares are pruned on
 * every mutation and never served.
 */

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { ShareStats, TranscriptEntry } from '../shared/types'

export interface ShareEntry {
  token: string
  sessionId: string
  title: string
  createdAt: number
  expiresAt?: number
  entries: TranscriptEntry[]
  /**
   * Whether this snapshot kept the machine-facing parts of the session (tool
   * calls, injected context, stats). Absent on shares created before the
   * setting existed — those are treated as technical, which is what they are.
   */
  technical?: boolean
  /** Session statistics frozen with the snapshot (absent on older shares). */
  stats?: ShareStats
  /** Number of secret patterns redacted when this snapshot was frozen. */
  redactedCount?: number
}

interface PersistShape {
  version: 1
  shares: ShareEntry[]
}

const MAX_SHARES = 100

function defaultFile(): string {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : homedir()
  return join(home, '.dsh', 'dsh-share.json')
}

export class ShareStore {
  private readonly file: string
  private readonly map = new Map<string, ShareEntry>()
  private readonly ready: Promise<void>

  constructor(file?: string) {
    this.file = file ?? defaultFile()
    this.ready = this.load()
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as PersistShape
      if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.shares)) {
        for (const share of parsed.shares) {
          if (share !== null && typeof share === 'object' && typeof share.token === 'string') {
            this.map.set(share.token, share)
          }
        }
      }
    } catch (err) {
      // Missing or corrupt file: start empty (never crash the plugin on load).
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Best-effort: ignore malformed persistence and continue empty.
      }
    }
    this.pruneExpired(Date.now())
  }

  async add(entry: ShareEntry): Promise<void> {
    await this.ready
    this.map.set(entry.token, entry)
    this.pruneExpired(Date.now())
    while (this.map.size > MAX_SHARES) {
      const oldest = [...this.map.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
      if (oldest === undefined) break
      this.map.delete(oldest.token)
    }
    await this.persist()
  }

  async get(token: string): Promise<ShareEntry | undefined> {
    await this.ready
    const entry = this.map.get(token)
    if (entry === undefined) return undefined
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) return undefined
    return entry
  }

  async remove(token: string): Promise<boolean> {
    await this.ready
    const deleted = this.map.delete(token)
    if (deleted) await this.persist()
    return deleted
  }

  /** Metadata list (no transcript payloads), newest first. */
  async list(): Promise<ShareEntry[]> {
    await this.ready
    this.pruneExpired(Date.now())
    return [...this.map.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  private pruneExpired(now: number): void {
    for (const [token, entry] of this.map) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.map.delete(token)
    }
  }

  private async persist(): Promise<void> {
    const shape: PersistShape = { version: 1, shares: [...this.map.values()] }
    const body = JSON.stringify(shape)
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, this.file)
  }
}
