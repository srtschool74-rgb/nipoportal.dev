"use client";

import { useState, useEffect, useCallback } from "react";
import type { AdminDashboardSummary } from "@/shared/types/stats";

const STATS_EVENT = "srt:stats-updated";

/**
 * Emits a cross-component & cross-tab event so any mounted stats view
 * refreshes cleanly from `/api/stats/summary` without a hard browser reload.
 */
export function notifyStatsUpdated(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(STATS_EVENT));
    if ("BroadcastChannel" in window) {
      const ch = new BroadcastChannel("srt-stats-sync");
      ch.postMessage({ type: "UPDATED", at: Date.now() });
      ch.close();
    }
  } catch {}
}

/**
 * Live-syncs stats summary from `/api/stats/summary` on mutation events and tab focus,
 * maintaining an explicit `isLoading` flag so initial client loads can render skeletons
 * rather than flashing a misleading "0".
 */
export function useStatsLiveRefresh(initialSummary: AdminDashboardSummary | null = null) {
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(initialSummary);
  const [isLoading, setIsLoading] = useState<boolean>(initialSummary === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSummary !== null) {
      setSummary(initialSummary);
      setIsLoading(false);
      setError(null);
    }
  }, [initialSummary]);

  const refresh = useCallback(async () => {
    setIsLoading((prev) => (summary === null ? true : prev));
    setError(null);
    try {
      const res = await fetch("/api/stats/summary", { cache: "no-store" });
      if (!res.ok) {
        setError(`Failed to load dashboard stats (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      if (data?.success && data.summary) {
        setSummary(data.summary);
        setError(null);
      } else {
        setError(data?.error || "Failed to load dashboard stats");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error loading dashboard stats");
    } finally {
      setIsLoading(false);
    }
  }, [summary]);

  useEffect(() => {
    if (initialSummary === null) {
      void refresh();
    }

    const onEvent = () => {
      void refresh();
    };
    const onVisible = () => {
      if (!document.hidden) {
        void refresh();
      }
    };

    window.addEventListener(STATS_EVENT, onEvent);
    window.addEventListener("focus", onEvent);
    document.addEventListener("visibilitychange", onVisible);

    let channel: BroadcastChannel | null = null;
    try {
      if ("BroadcastChannel" in window) {
        channel = new BroadcastChannel("srt-stats-sync");
        channel.onmessage = () => void refresh();
      }
    } catch {}

    return () => {
      window.removeEventListener(STATS_EVENT, onEvent);
      window.removeEventListener("focus", onEvent);
      document.removeEventListener("visibilitychange", onVisible);
      try {
        channel?.close();
      } catch {}
    };
  }, [initialSummary, refresh]);

  return { summary, isLoading, error, refresh };
}
