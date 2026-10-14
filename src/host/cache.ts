/**
 * A bounded in-memory cache for rendered session pages.
 *
 * A share is a FROZEN snapshot — its transcript can never change after
 * creation — yet the page was re-rendered from scratch on every request. That
 * is pure waste on a normal page and a real amplification risk on a large one:
 * a LAN client hitting `/s/<token>` in a loop would otherwise drive a full
 * Markdown render and HTML build per request, burning CPU proportional to the
 * transcript size rather than to the response.
 *
 * Bounds are explicit so the cache can never become its own memory problem:
 *
 *   - a **total byte budget** for all entries, with FIFO eviction;
 *   - a **per-page cap**, so one enormous snapshot is served directly instead
 *     of evicting the whole cache to make room for itself;
 *   - entries carry their own expiry, so a cached page is re-checked against
 *     the share's `expiresAt` and is dropped rather than outliving it.
 *
 * Removing a share (`remove`) and expiry are the only ways a page ends, so
 * those are the only two invalidation paths.
 */

export interface CachedPage {
  html: string
  /** Share expiry (ms epoch), or undefined for "never". */
  expiresAt?: number
}

export interface PageCacheOptions {
  /** Total bytes of rendered HTML retained. */
  maxBytes: number
  /** Largest single page worth caching. */
  maxPageBytes: number
}

export class RenderedPageCache {
  private readonly map = new Map<string, { html: string; bytes: number; expiresAt?: number }>()
  private bytes = 0

  constructor(private readonly options: PageCacheOptions) {}

  /** The cached page for `token`, or undefined. Expired entries are dropped. */
  get(token: string, now: number): string | undefined {
    const hit = this.map.get(token)
    if (hit === undefined) return undefined
    if (hit.expiresAt !== undefined && hit.expiresAt <= now) {
      this.delete(token)
      return undefined
    }
    return hit.html
  }

  /** Retain a rendered page, evicting oldest-first until it fits. */
  set(token: string, page: CachedPage): void {
    const bytes = Buffer.byteLength(page.html)
    if (bytes > this.options.maxPageBytes) return // too big to be worth caching
    this.delete(token)
    this.map.set(token, { html: page.html, bytes, ...(page.expiresAt !== undefined ? { expiresAt: page.expiresAt } : {}) })
    this.bytes += bytes
    while (this.bytes > this.options.maxBytes) {
      const oldest = this.map.keys().next()
      if (oldest.done === true) break
      this.delete(oldest.value)
    }
  }

  delete(token: string): void {
    const hit = this.map.get(token)
    if (hit === undefined) return
    this.map.delete(token)
    this.bytes -= hit.bytes
  }

  /**
   * Drop every cached page whose share is no longer in the store.
   *
   * Needed because a share can leave the store without an explicit revoke:
   * `add` evicts the oldest entries once `MAX_SHARES` is reached. Without this,
   * a page could keep being served for a share the store has already dropped.
   */
  prune(keep: ReadonlySet<string>): void {
    for (const token of [...this.map.keys()]) {
      if (!keep.has(token)) this.delete(token)
    }
  }

  clear(): void {
    this.map.clear()
    this.bytes = 0
  }

  /** Retained bytes; exposed for tests and diagnostics. */
  get size(): number {
    return this.bytes
  }
}
