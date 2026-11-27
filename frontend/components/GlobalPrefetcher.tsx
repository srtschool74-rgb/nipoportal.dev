"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getPersistedNativeSession } from "@/frontend/lib/authPersistence";

/**
 * GlobalPrefetcher
 * 
 * Aggressive background prefetching engine designed to eliminate all lags, delays,
 * and cold-start latencies when opening or navigating the school portal.
 * 
 * Features:
 * 1. Warm-up: Non-blocking background call to /api/warmup to prime DB pooler.
 * 2. Idle Prefetching: Prefetches all core role dashboards during idle time.
 * 3. Anticipatory Touch/Hover Prefetching: Pre-caches any internal link on touch/hover.
 * 4. Background Re-warm: Re-primes connection when returning to app after hours.
 */
export default function GlobalPrefetcher() {
  const router = useRouter();
  const prefetchedUrls = useRef<Set<string>>(new Set());
  const lastWarmupRef = useRef<number>(Date.now());

  const safePrefetch = (url: string) => {
    if (!url || prefetchedUrls.current.has(url)) return;
    try {
      prefetchedUrls.current.add(url);
      router.prefetch(url);
    } catch {
      // Ignore prefetch failures in unsupported contexts
    }
  };

  const warmDatabase = () => {
    try {
      const now = Date.now();
      const lastStored = Number(sessionStorage.getItem("srt_db_warm_ts") || "0");
      if (now - lastStored < 20 * 60 * 1000) {
        return; // Already warmed within 20 minutes; avoid opening extra serverless DB connections
      }
      sessionStorage.setItem("srt_db_warm_ts", String(now));
      lastWarmupRef.current = now;
      fetch("/api/warmup", { priority: "low" as any }).catch(() => {});
    } catch {}
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Warm database connection pooler only on public login landing (authenticated pages already touch DB)
    const path = window.location.pathname || "/";
    if (path === "/" || path.startsWith("/login")) {
      warmDatabase();
    }

    // 2. Prefetch ONLY the role dashboard when already on an authenticated route (never poison login Router Cache)
    if (path !== "/" && !path.startsWith("/login")) {
      getPersistedNativeSession()
        .then((session) => {
          if (session?.role) {
            const role = session.role.toUpperCase();
            const target =
              role === "ADMIN"
                ? "/dashboard/admin"
                : role === "TEACHER"
                ? "/dashboard/teacher"
                : role === "PARENT"
                ? "/dashboard/parent"
                : role === "STAFF" || role === "NON_TEACHING_STAFF"
                ? "/staff/my-bus"
                : "/dashboard";
            safePrefetch(target);
          }
        })
        .catch(() => {});
    }

    // 3. Anticipatory Hover & Touch Prefetching for all internal links
    const handlePointerOrTouch = (e: Event) => {
      const target = (e.target as HTMLElement)?.closest("a");
      if (!target || !target.href) return;

      if (
        target.hasAttribute("download") ||
        target.target === "_blank" ||
        target.rel?.includes("external")
      ) {
        return;
      }

      try {
        const url = new URL(target.href, window.location.origin);
        if (url.origin === window.location.origin && url.pathname) {
          safePrefetch(url.pathname);
        }
      } catch {}
    };

    document.addEventListener("pointerover", handlePointerOrTouch, { passive: true });
    document.addEventListener("touchstart", handlePointerOrTouch, { passive: true });

    // 5. Re-warm database connection when app becomes visible after hours of idle
    const handleVisibilityChange = () => {
      if (!document.hidden && Date.now() - lastWarmupRef.current > 15 * 60 * 1000) {
        warmDatabase();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("pointerover", handlePointerOrTouch);
      document.removeEventListener("touchstart", handlePointerOrTouch);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router]);

  return null;
}
