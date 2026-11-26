"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, CheckCircle2, Loader2, X, AlertTriangle } from "lucide-react";
import styles from "./PwaWelcomeNotificationPrompt.module.css";

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

export default function PwaWelcomeNotificationPrompt() {
  const [isOpen, setIsOpen] = useState(false);
  const [showFloatingPill, setShowFloatingPill] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Check notification permission on portal opening
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }

    const currentPerm = Notification.permission;
    setPermission(currentPerm);

    // If permission already granted or denied, don't show prompt
    if (currentPerm !== "default") {
      setIsOpen(false);
      setShowFloatingPill(false);
      return;
    }

    // Listen for chained event from Install prompt or splash complete
    const handleOpenFromEvent = () => {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        setTimeout(() => {
          setIsOpen(true);
          setShowFloatingPill(false);
        }, 350);
      }
    };

    window.addEventListener("open-notification-prompt", handleOpenFromEvent);

    // Auto-prompt on login page if install prompt is already completed or after 1.5s
    const isLogin = window.location.pathname.startsWith("/login") || window.location.pathname === "/";
    const timer = setTimeout(() => {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        // If install prompt is not currently visible, show notification prompt
        const installModal = document.querySelector("[data-testid='unified-install-modal']");
        if (!installModal) {
          setIsOpen(true);
          setShowFloatingPill(false);
        }
      }
    }, isLogin ? 2200 : 1200);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("open-notification-prompt", handleOpenFromEvent);
    };
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem("srt_notif_prompted_once", "true");
      localStorage.setItem("srt_pwa_notif_dismissed_v1", "true");
    } catch {}
    setIsOpen(false);
    setShowFloatingPill(false);
  };

  const handleOpenPrompt = () => {
    setErrorMsg(null);
    setIsOpen(true);
    setShowFloatingPill(false);
  };

  const handleEnableNotifications = useCallback(async () => {
    setErrorMsg(null);
    setLoading(true);

    try {
      // 1. Request user permission
      const requestedPerm = await Notification.requestPermission();
      setPermission(requestedPerm);

      if (requestedPerm !== "granted") {
        setLoading(false);
        setErrorMsg(
          requestedPerm === "denied"
            ? "Notifications are blocked. Please click the tune/lock icon in your browser URL bar and change Notifications to 'Allow'."
            : "Notification permission was not granted."
        );
        return;
      }

      // 2. Register / retrieve active Service Worker
      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        registration = await navigator.serviceWorker.register("/OneSignalSDKWorker.js", { scope: "/" });
      }
      await navigator.serviceWorker.ready;

      // 3. Fetch VAPID Public Key
      const keyRes = await fetch("/api/notifications/push/public-key");
      const keyData = await keyRes.json();
      const vapidPublicKey = keyData?.publicKey || "BBIHzbc-DVhlpPB_plCE0gUMpCSsHiqA1Y5FVyP-ax6p0HWnFZILFISth4FYfyAp0gywswCBxz4GfDnXm_c-Agk";

      // 4. Subscribe with PushManager
      const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        try {
          await subscription.unsubscribe();
        } catch {}
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey as unknown as BufferSource,
      });

      // 5. Send subscription to backend API to register device
      const rawSub = subscription.toJSON();
      let p256dh = rawSub.keys?.p256dh;
      let auth = rawSub.keys?.auth;

      if ((!p256dh || !auth) && subscription.getKey) {
        try {
          const rawKey = subscription.getKey("p256dh");
          if (rawKey) {
            p256dh = btoa(String.fromCharCode(...new Uint8Array(rawKey)))
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/, "");
          }
          const rawAuth = subscription.getKey("auth");
          if (rawAuth) {
            auth = btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/, "");
          }
        } catch {}
      }

      const payload = {
        endpoint: subscription.endpoint,
        keys: { p256dh, auth },
        userAgent: navigator.userAgent,
        deviceName: navigator.userAgent.includes("Android")
          ? "Android PWA"
          : navigator.userAgent.includes("iPhone")
          ? "iOS PWA"
          : "Desktop PWA",
      };

      await Promise.allSettled([
        fetch("/api/notifications/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ]);

      // Store endpoint locally
      try {
        localStorage.setItem("nipo_pwa_push_endpoint", subscription.endpoint);
      } catch {}

      setIsSuccess(true);
      setLoading(false);
      setShowFloatingPill(false);

      // Auto-close after showing success
      setTimeout(() => {
        setIsOpen(false);
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error enabling notifications.";
      console.error("[PwaWelcome] Enable push error:", err);
      setErrorMsg(msg);
      setLoading(false);
    }
  }, []);

  if (permission === "granted" || permission === "unsupported") {
    return null;
  }

  return (
    <>
      {/* Floating Action Pill: Always available on screen until user enables notifications */}
      {showFloatingPill && !isOpen && (
        <button
          type="button"
          className={styles.floatingEnablePill}
          onClick={handleOpenPrompt}
          aria-label="Enable notifications"
        >
          <Bell size={18} />
          <span>Enable Notifications</span>
        </button>
      )}

      {/* Main Notification Prompt Modal */}
      {isOpen && (
        <div
          className={styles.backdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-notif-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleDismiss();
          }}
        >
          <div className={styles.modal}>
            {/* Top Close (X) Button */}
            <button
              type="button"
              className={styles.topCloseBtn}
              onClick={handleDismiss}
              aria-label="Close"
              title="Close"
            >
              <X size={18} />
            </button>

            {/* Centered Circular Bell Icon with Glow Ring */}
            <div className={styles.iconContainer}>
              <div className={styles.iconOuterRing}>
                <div className={styles.iconInnerCircle}>
                  <Bell size={24} className={styles.bellIcon} />
                </div>
              </div>
            </div>

            {/* Centered Heading & Subtitle */}
            <div className={styles.contentArea}>
              <h3 id="welcome-notif-title" className={styles.title}>
                Stay in the loop
              </h3>
              <p className={styles.desc}>
                Get timely updates and never miss out on what matters.
              </p>

              {permission === "denied" && (
                <div className={styles.deniedAlert}>
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span>Notifications are blocked in your browser. Please tap the lock/tune icon in your address bar and set Notifications to Allow.</span>
                </div>
              )}

              {isSuccess ? (
                <div className={styles.successCard}>
                  <CheckCircle2 size={18} color="#059669" />
                  <span>Notifications enabled successfully!</span>
                </div>
              ) : errorMsg ? (
                <div className={styles.errorText}>
                  {errorMsg}
                </div>
              ) : null}
            </div>

            {/* Single Action Button (No 'Maybe later') */}
            {!isSuccess && (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.enableBtn}
                  onClick={handleEnableNotifications}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>Enabling...</span>
                    </>
                  ) : (
                    <span>Enable notifications</span>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
