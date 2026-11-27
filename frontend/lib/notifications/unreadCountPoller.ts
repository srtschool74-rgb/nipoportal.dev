"use client";

export interface UnreadStats {
  unreadCount: number;
  hasBusAlert: boolean;
  notificationCount?: number;
  messageCount?: number;
}

let cachedStats: UnreadStats | null = null;
let lastFetchTime = 0;
let inFlightPromise: Promise<UnreadStats | null> | null = null;
const subscribers = new Set<(stats: UnreadStats) => void>();

/**
 * Shared singleton poller & request deduplicator for /api/notifications/unread-count.
 * - Guarantees only 1 in-flight network request at a time
 * - 15-second freshness cache collapses concurrent callers
 * - Sends clearedTime via 'x-cleared-time' header, keeping the URL canonical and cache-dedupable
 * - Skips network calls when tab is hidden or device screen is locked
 */
export async function getUnreadNotificationStats(force = false): Promise<UnreadStats | null> {
  if (typeof window === "undefined") return null;

  // Pause polling if the tab/browser is hidden or device screen is locked
  if (document.hidden && !force) {
    return cachedStats;
  }

  const now = Date.now();
  // Return cached stats if fresh (<15s) and not forced
  if (!force && cachedStats && now - lastFetchTime < 15000) {
    return cachedStats;
  }

  // Deduplicate concurrent callers: return the existing in-flight promise
  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
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
      });

      if (!res.ok) {
        return cachedStats;
      }

      const data = await res.json();
      if (data && data.success) {
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
      return cachedStats;
    } finally {
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

