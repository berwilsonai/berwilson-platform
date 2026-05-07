/**
 * Simple in-memory sliding-window rate limiter.
 * Tracks request timestamps per key and enforces a max count within a window.
 *
 * This is per-instance (resets on redeploy) — sufficient for a small team.
 * For multi-instance deployment, swap to Redis/Upstash.
 */

const store = new Map<string, number[]>()

// Clean stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000

let lastCleanup = Date.now()

function cleanup(windowMs: number) {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now

  const cutoff = now - windowMs * 2
  for (const [key, timestamps] of store) {
    const valid = timestamps.filter(t => t > cutoff)
    if (valid.length === 0) {
      store.delete(key)
    } else {
      store.set(key, valid)
    }
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

/**
 * Check if a request is within rate limits.
 *
 * @param key - Unique identifier (e.g. "agent:userId")
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Window size in milliseconds
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  cleanup(windowMs)

  const now = Date.now()
  const cutoff = now - windowMs
  const timestamps = store.get(key) ?? []

  // Remove timestamps outside the window
  const valid = timestamps.filter(t => t > cutoff)

  if (valid.length >= maxRequests) {
    // Find when the oldest request in the window expires
    const oldestInWindow = valid[0]
    const retryAfterMs = oldestInWindow + windowMs - now

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(retryAfterMs, 1000),
    }
  }

  // Allow and record
  valid.push(now)
  store.set(key, valid)

  return {
    allowed: true,
    remaining: maxRequests - valid.length,
    retryAfterMs: 0,
  }
}
