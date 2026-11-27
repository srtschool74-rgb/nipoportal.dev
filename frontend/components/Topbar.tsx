"use client";

import styles from "./Topbar.module.css";
import { usePathname, useRouter } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import { Bell, Send, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { useEffect, useState, useCallback, useRef } from "react";
import { setAppBadgeCount, clearAppBadgeCount } from "@/frontend/lib/pwa/badgeManager";
import RoleSwitcher from "@/frontend/components/auth/RoleSwitcher";
import { getUserInitials, formatDisplayName } from "@/frontend/lib/initials";
import {
  getUnreadNotificationStats,
  subscribeToUnreadStats,
  resetUnreadStatsLocally,
  updateUnreadStatsLocally,
  type UnreadStats,
} from "@/frontend/lib/notifications/unreadCountPoller";
import {
  requestOneSignalPermission,
  loginToOneSignal,
  getOneSignalSubscriptionState,
} from "@/frontend/lib/onesignal";

// Matches the key used in NotificationPopupModal
const CLEARED_KEY = "srt_portal_notif_cleared_v1";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function Topbar({
  user,
}: {
  user: { id?: string | null; name?: string | null; role?: string | null };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [showRedDot, setShowRedDot] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [hasBusAlert, setHasBusAlert] = useState<boolean>(false);
  const [isTestingPush, setIsTestingPush] = useState<boolean>(false);
  const isTestingPushRef = useRef<boolean>(false);
  const [testPushSuccess, setTestPushSuccess] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "warning" | "error";
    action?: { label: string; onClick: () => void };
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (
    message: string,
    type: "success" | "warning" | "error",
    durationMs = 4000,
    action?: { label: string; onClick: () => void }
  ) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type, action });
    toastTimerRef.current = setTimeout(() => setToast(null), durationMs);
  };

  const handleEnablePushAndRetry = async () => {
    setToast(null);
    const granted = await requestOneSignalPermission();
    if (!granted) {
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        showToast(
          "Notifications are blocked in browser settings. Click the lock icon near the URL to allow them.",
          "warning",
          6000
        );
      } else {
        showToast("Please allow browser notifications to receive alerts on this device.", "warning", 4500);
      }
      return;
    }
    if (user?.id) {
      await loginToOneSignal(user.id).catch(() => {});
    }
    await handleTestLockScreenNotification();
  };

  const handleTestLockScreenNotification = async () => {
    if (isTestingPushRef.current) return;
    isTestingPushRef.current = true;
    setIsTestingPush(true);
    try {
      // Ensure current device has permission & OneSignal opt-in + external_id before server dispatch
      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "denied") {
            showToast(
              "Notifications are blocked in browser settings. Click the lock icon near the URL to allow them.",
              "warning",
              6000
            );
            return;
          }

          const granted = await requestOneSignalPermission();
          if (!granted && typeof Notification !== "undefined" && Notification.permission !== "granted") {
            showToast("Please allow browser notifications to receive alerts on this device.", "warning", 4000);
            return;
          }

          if (user?.id) {
            await loginToOneSignal(user.id).catch(() => {});
            console.log("[Topbar] OneSignal state before test push:", getOneSignalSubscriptionState());
          }

          const reg = await navigator.serviceWorker.ready;
          if (reg.pushManager) {
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
              const keyRes = await fetch("/api/notifications/push/public-key").catch(() => null);
              const keyData = await keyRes?.json().catch(() => null);
              if (keyData?.publicKey) {
                const keyArr = urlBase64ToUint8Array(keyData.publicKey);
                sub = await reg.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: keyArr as unknown as BufferSource,
                }).catch(() => null);
              }
            }

            if (sub) {
              const subJson = sub.toJSON();
              let p256dh = subJson.keys?.p256dh;
              let auth = subJson.keys?.auth;

              if ((!p256dh || !auth) && sub.getKey) {
                try {
                  const rawKey = sub.getKey("p256dh");
                  if (rawKey) {
                    p256dh = btoa(String.fromCharCode(...new Uint8Array(rawKey)))
                      .replace(/\+/g, "-")
                      .replace(/\//g, "_")
                      .replace(/=+$/, "");
                  }
                  const rawAuth = sub.getKey("auth");
                  if (rawAuth) {
                    auth = btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
                      .replace(/\+/g, "-")
                      .replace(/\//g, "_")
                      .replace(/=+$/, "");
                  }
                } catch {}
              }

              if (subJson.endpoint && p256dh && auth) {
                await fetch("/api/push/subscribe", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    endpoint: subJson.endpoint,
                    keys: { p256dh, auth },
                    platform: /android/i.test(navigator.userAgent) ? "ANDROID" : /iphone|ipad/i.test(navigator.userAgent) ? "IOS" : "WEB",
                    userAgent: navigator.userAgent,
                  }),
                }).catch(() => {});
              }
            }
          }
        } catch (err) {
          console.warn("[Topbar] Push registration warning:", err);
        }
      }

      // Generate a unique idempotency key per click; server dispatches ONE notification strictly to this admin
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "🔔 SRT Portal Alert",
          message: `${user.name || "Administrator"}: Test push alert is active on your device!`,
          url: "/dashboard",
          broadcast: false,
          idempotencyKey,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success && (data.delivered ?? 0) >= 1) {
        setTestPushSuccess(true);
        showToast(`Test notification sent (${data.delivered} device${data.delivered > 1 ? "s" : ""}).`, "success", 3500);
        setTimeout(() => setTestPushSuccess(false), 2500);
      } else if (data?.code === "NO_ACTIVE_SUBSCRIPTION") {
        showToast(
          data.error || "No active device registered for this account. Enable notifications on this device.",
          "warning",
          7000,
          { label: "Enable Notifications", onClick: handleEnablePushAndRetry }
        );
      } else {
        showToast(data?.error || "Could not send test notification.", "error", 4500);
      }
    } catch {
      showToast("Network error while sending test notification.", "error", 4000);
    } finally {
      isTestingPushRef.current = false;
      setIsTestingPush(false);
    }
  };

  // Shared unread notification listener via singleton deduplicator
  useEffect(() => {
    const unsubscribe = subscribeToUnreadStats((stats: UnreadStats) => {
      setUnreadCount(stats.unreadCount);
      setHasBusAlert(stats.hasBusAlert);
      setShowRedDot(stats.unreadCount > 0 || stats.hasBusAlert);
      setAppBadgeCount(stats.unreadCount).catch(() => {});
    });

    // Initial check (cached/deduplicated)
    getUnreadNotificationStats().then((stats) => {
      if (stats) {
        setUnreadCount(stats.unreadCount);
        setHasBusAlert(stats.hasBusAlert);
        setShowRedDot(stats.unreadCount > 0 || stats.hasBusAlert);
        setAppBadgeCount(stats.unreadCount).catch(() => {});
      }
    });

    const interval = setInterval(() => {
      if (!document.hidden) {
        getUnreadNotificationStats();
      }
    }, 60000); // 60s shared polling interval

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        getUnreadNotificationStats();
      }
    };

    const handleWindowFocus = () => {
      if (!document.hidden) {
        getUnreadNotificationStats();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    // Listen for notification-cleared event
    const handleCleared = () => {
      setShowRedDot(false);
      setUnreadCount(0);
      setHasBusAlert(false);
      resetUnreadStatsLocally();
      clearAppBadgeCount().catch(() => {});
    };

    // Listen for incremental/direct count change events
    const handleCountChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ unreadCount?: number; delta?: number }>;
      if (typeof customEvent.detail?.unreadCount === "number") {
        const c = Math.max(0, customEvent.detail.unreadCount);
        updateUnreadStatsLocally(c);
      } else if (typeof customEvent.detail?.delta === "number") {
        setUnreadCount((prev) => {
          const next = Math.max(0, prev + customEvent.detail.delta!);
          updateUnreadStatsLocally(next);
          return next;
        });
      }
    };

    // Listen for ServiceWorker badge changes (when push arrives in background)
    const handleSwMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === "APP_BADGE_CHANGED") {
        const count = typeof e.data.count === "number" ? e.data.count : 0;
        if (count >= 0) {
          updateUnreadStatsLocally(count);
        } else if (count === -1) {
          // Midnight refresh signal: recheck notifications
          getUnreadNotificationStats(true);
        }
      }
    };

    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleSwMessage);
    }

    window.addEventListener("notifications-cleared", handleCleared);
    window.addEventListener("notification-count-changed", handleCountChanged);

    return () => {
      unsubscribe();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("notifications-cleared", handleCleared);
      window.removeEventListener("notification-count-changed", handleCountChanged);
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleSwMessage);
      }
    };
  }, []);

  return (
    <header className={styles.topbar}>
      <div className={styles.leftSection}></div>
      <div className={styles.userInfo}>
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("open-notification-popup"));
          }}
          title={hasBusAlert ? "Urgent Bus Transit Alert! View Notifications" : "View Notifications"}
          aria-label="View Notifications"
          style={{
            background: hasBusAlert ? "rgba(239, 68, 68, 0.15)" : "var(--card-bg, #ffffff)",
            border: hasBusAlert ? "1.5px solid #ef4444" : "1px solid var(--border-color)",
            borderRadius: "50%",
            width: "38px",
            height: "38px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: hasBusAlert ? "#ef4444" : "#f59e0b",
            position: "relative",
            marginRight: "0.35rem",
            transition: "all 0.2s ease",
            boxShadow: hasBusAlert ? "0 0 10px rgba(239, 68, 68, 0.4)" : "0 2px 6px rgba(0,0,0,0.04)",
            flexShrink: 0,
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = "scale(1.06)";
            e.currentTarget.style.borderColor = hasBusAlert ? "#ef4444" : "var(--primary)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.borderColor = hasBusAlert ? "#ef4444" : "var(--border-color)";
          }}
        >
          <Bell size={18} />
          {showRedDot && (
            <span
              style={{
                position: "absolute",
                top: "-2px",
                right: "-2px",
                minWidth: unreadCount > 0 ? "16px" : "8px",
                height: unreadCount > 0 ? "16px" : "8px",
                padding: unreadCount > 0 ? "0 4px" : "0",
                borderRadius: "10px",
                backgroundColor: hasBusAlert ? "#ef4444" : "#f59e0b",
                color: "#ffffff",
                fontSize: "0.68rem",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1.5px solid var(--card-bg, #ffffff)",
                boxShadow: hasBusAlert ? "0 0 6px #ef4444" : "none",
              }}
            >
              {unreadCount > 0 ? (unreadCount > 9 ? "9+" : unreadCount) : ""}
            </span>
          )}
        </button>

        {/* Test Push button: Strictly ADMIN only */}
        {user && (user.role === "ADMIN" || user.role === "SUPER_ADMIN") && (
          <button
            type="button"
            onClick={handleTestLockScreenNotification}
            disabled={isTestingPush}
            title="Send a real test push notification"
            aria-label="Test Lock-Screen Notification"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: "0.35rem 0.65rem",
              borderRadius: "8px",
              fontSize: "0.76rem",
              fontWeight: 700,
              background: testPushSuccess
                ? "linear-gradient(135deg, #059669, #10b981)"
                : "linear-gradient(135deg, #2563eb, #1d4ed8)",
              color: "#ffffff",
              border: "none",
              cursor: isTestingPush ? "wait" : "pointer",
              boxShadow: "0 2px 6px rgba(37, 99, 235, 0.3)",
              marginRight: "0.35rem",
              whiteSpace: "nowrap",
              transition: "all 0.15s ease",
            }}
          >
            <Send size={13} />
            <span>{isTestingPush ? "Testing..." : testPushSuccess ? "✓ Sent!" : "Test Push"}</span>
          </button>
        )}

        {/* Multi-role switcher pill for dual-role users (e.g. Teacher with enrolled child) */}
        <RoleSwitcher
          currentRole={user?.role || undefined}
          availableRoles={(user as any)?.availableRoles || undefined}
          style={{ marginRight: "0.4rem" }}
        />

        <ThemeToggle style={{ marginRight: "0.25rem" }} />
        <div className={styles.userDetails}>
          <span className={styles.userName}>{formatDisplayName(user?.name)}</span>
          <span className={styles.userRole}>{user?.role}</span>
        </div>
        <div className={styles.avatar}>{getUserInitials(user?.name)}</div>
      </div>

      {/* Floating non-intrusive toast - Zero browser alert popups */}
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: 999999,
            backgroundColor: "#1e293b",
            color: "#f8fafc",
            padding: "0.85rem 1.25rem",
            borderRadius: "14px",
            border:
              toast.type === "success"
                ? "1px solid #10b981"
                : toast.type === "warning"
                ? "1px solid #f59e0b"
                : "1px solid #ef4444",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            gap: "0.65rem",
            fontSize: "0.88rem",
            fontWeight: 600,
            maxWidth: "min(440px, calc(100vw - 32px))",
            pointerEvents: toast.action ? "auto" : "none",
          }}
        >
          {toast.type === "success" && <CheckCircle2 size={18} color="#10b981" style={{ flexShrink: 0 }} />}
          {toast.type === "warning" && <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0 }} />}
          {toast.type === "error" && <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0 }} />}
          <span style={{ flex: 1 }}>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={toast.action.onClick}
              style={{
                padding: "0.35rem 0.65rem",
                borderRadius: "8px",
                border: "none",
                background: "#2563eb",
                color: "#ffffff",
                fontSize: "0.78rem",
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </header>
  );
}
