/**
 * Simple LRU (Least Recently Used) cache implementation
 * Uses Map to maintain insertion order
 *
 * Optionally bounds entry lifetime with a TTL. Expiry is lazy: entries are
 * dropped when read, not on a timer. Pass no ttlMs for entries that live until
 * evicted by size or removed explicitly.
 */

interface CacheEntry<V> {
  value: V;
  /** Epoch ms after which the entry is stale. Infinity when no TTL is set. */
  expiresAt: number;
}

export class LRUCache<K, V> {

  private cache: Map<K, CacheEntry<V>>;
  private readonly maxSize: number;
  private readonly ttlMs: number | undefined;

  /**
   * @param maxSize Entries retained before the least recently used is evicted.
   * @param ttlMs Entry lifetime in ms. Omit for no expiry. Zero means every
   *   entry is born expired, which disables caching without a code change.
   */
  constructor(maxSize: number = 1000, ttlMs?: number) {

    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Compute the expiry stamp for an entry written now.
   * Guards `ttlMs === 0` explicitly: zero is falsy but means "always expired",
   * the opposite of the no-TTL case.
   */
  private nextExpiry(): number {

    return this.ttlMs === undefined ? Infinity : Date.now() + this.ttlMs;
  }

  /**
   * Read an entry, dropping it first if it has expired.
   * Returns undefined for both a miss and an expired entry.
   */
  private live(key: K): CacheEntry<V> | undefined {

    const entry = this.cache.get(key);

    if (entry === undefined) {

      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {

      this.cache.delete(key);

      return undefined;
    }

    return entry;
  }

  /**
   * Get value from cache
   * Moves accessed item to end (most recently used)
   */
  get(key: K): V | undefined {

    const entry = this.live(key);

    if (entry === undefined) {

      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set value in cache
   * Evicts least recently used item if cache is full
   */
  set(key: K, value: V): void {

    // Remove if already exists (to update position)
    if (this.cache.has(key)) {

      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {

      const firstKey = this.cache.keys().next().value;

      if (firstKey !== undefined) {

        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, { value, expiresAt: this.nextExpiry() });
  }

  /**
   * Check if key exists in cache
   */
  has(key: K): boolean {

    return this.live(key)?.value !== undefined;
  }

  /**
   * Delete key from cache
   */
  delete(key: K): boolean {

    return this.cache.delete(key);
  }

  /**
   * Clear entire cache
   */
  clear(): void {

    this.cache.clear();
  }

  /**
   * Get current cache size. Counts entries that have expired but not yet been
   * read, since expiry is lazy.
   */
  get size(): number {

    return this.cache.size;
  }
}
