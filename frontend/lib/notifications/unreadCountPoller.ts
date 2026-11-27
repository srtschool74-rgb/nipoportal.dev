"use client";

export interface UnreadStats {
  unreadCount: number;
  hasBusAlert: boolean;
  notificationCount?: number;
  messageCount?: number;
}

let cachedStats: UnreadStats | null = null;
let lastFetchTime = 0;
let consecutiveErrors = 0;
let backoffUntil = 0;
let inFlightPromise: Promise<UnreadStats | null> | null = null;
const subscribers = new Set<(stats: UnreadStats) => void>();

/**
 * Shared singleton poller & request deduplicator for /api/notifications/unread-count.
 * - Guarantees only 1 in-flight network request at a time
 * - 15-second freshness cache collapses concurrent callers
 * - Exponential backoff on errors (up to 2 min) to prevent request floods
 * - 10s AbortController timeout
 * - Skips network calls when tab is hidden or device screen is locked
 */
export async function getUnreadNotificationStats(force = false): Promise<UnreadStats | null> {
  if (typeof window === "undefined") return null;

  // Pause polling if the tab/browser is hidden or device screen is locked
  if (document.hidden && !force) {
    return cachedStats;
  }

  const now = Date.now();
  if (!force && now < backoffUntil) {
    return cachedStats;
  }

  // Return cached stats if fresh (<15s) and not forced
  if (!force && cachedStats && now - lastFetchTime < 15000) {
    return cachedStats;
  }

  // Deduplicate concurrent callers: return the existing in-flight promise
  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const clearedTime = localStorage.getItem("srt_portal_notif_cleared_time");
      const headers: Record<string, string> = {
        "Cache-Control": "no-cache",
      };
      if (clearedTime) {
        headers["x-cleared-time"] = clearedTime;
      }

      // Canonical URL without changing query params
      const res = await fetch("/api/notifications/unread-count", {
        headers,
        cache: "no-store",
        signal: controller.signal,
      });

      if (!res.ok) {
        consecutiveErrors += 1;
        backoffUntil = Date.now() + Math.min(120000, 15000 * Math.pow(2, consecutiveErrors - 1));
        return cachedStats;
      }

      const data = await res.json();
      if (data && data.success) {
        consecutiveErrors = 0;
        backoffUntil = 0;
        const stats: UnreadStats = {
          unreadCount: typeof data.unreadCount === "number" ? Math.max(0, data.unreadCount) : 0,
          hasBusAlert: Boolean(data.hasBusAlert),
          notificationCount: data.notificationCount,
          messageCount: data.messageCount,
        };

        cachedStats = stats;
        lastFetchTime = Date.now();

        // Broadcast to all active UI subscribers
        subscribers.forEach((cb) => {
          try {
            cb(stats);
          } catch (e) {
            console.debug("[UnreadPoller] Subscriber callback error:", e);
          }
        });

        return stats;
      }

      return cachedStats;
    } catch {
      consecutiveErrors += 1;
      backoffUntil = Date.now() + Math.min(120000, 15000 * Math.pow(2, consecutiveErrors - 1));
      return cachedStats;
    } finally {
      clearTimeout(timeoutId);
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}

/**
 * Subscribe a component to shared unread notification count updates
 */
export function subscribeToUnreadStats(callback: (stats: UnreadStats) => void): () => void {
  subscribers.add(callback);
  if (cachedStats) {
    try {
      callback(cachedStats);
    } catch {}
  }
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Optimistically clear unread notification count across all subscribed components
 */
export function resetUnreadStatsLocally(): void {
  const stats: UnreadStats = { unreadCount: 0, hasBusAlert: false };
  cachedStats = stats;
  lastFetchTime = Date.now();
  subscribers.forEach((cb) => {
    try {
      cb(stats);
    } catch {}
  });
}

/**
 * Optimistically set unread notification count across all subscribed components
 */
export function updateUnreadStatsLocally(unreadCount: number): void {
  const stats: UnreadStats = {
    unreadCount: Math.max(0, unreadCount),
    hasBusAlert: cachedStats?.hasBusAlert || false,
  };
  cachedStats = stats;
  lastFetchTime = Date.now();
  subscribers.forEach((cb) => {
    try {
      cb(stats);
    } catch {}
  });
}

