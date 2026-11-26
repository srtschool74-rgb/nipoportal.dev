"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { 
  Bell, 
  CheckCircle2, 
  Loader2, 
  X, 
  AlertTriangle, 
  Share2, 
  PlusSquare, 
  Smartphone,
  RefreshCw
} from "lucide-react";
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

  // Platform Detection
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [browserName, setBrowserName] = useState<string>("Browser");

  // Check notification permission and platform capabilities on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const ua = navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;

    setIsIOS(iosDevice);
    setIsStandalone(standalone);

    if (/Edg/i.test(ua)) setBrowserName("Edge");
    else if (/Chrome/i.test(ua)) setBrowserName("Chrome");
    else if (/Safari/i.test(ua)) setBrowserName("Safari");
    else if (/Firefox/i.test(ua)) setBrowserName("Firefox");

    // iOS Safari outside standalone mode: Notification API is unsupported by Apple
    if (iosDevice && !standalone) {
      setPermission("unsupported");

      // Check dismissal cooldown for iOS guidance
      const dismissUntil = parseInt(localStorage.getItem("srt_ios_install_prompt_dismiss") || "0", 10);
      if (Date.now() > dismissUntil) {
        const timer = setTimeout(() => {
          setIsOpen(true);
        }, 2000);
        return () => clearTimeout(timer);
      }
      return;
    }

    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }

    const currentPerm = Notification.permission;
    setPermission(currentPerm);

    // If permission already granted: ensure subscription is active on the server
    if (currentPerm === "granted") {
      setIsOpen(false);
      setShowFloatingPill(false);

      // Verify silent subscription in background
      navigator.serviceWorker.ready.then(async (reg) => {
        try {
          const sub = await reg.pushManager.getSubscription();
          if (!sub) {
            // Re-subscribe silently
            const keyRes = await fetch("/api/notifications/push/public-key").catch(() => null);
            if (keyRes && keyRes.ok) {
              const { publicKey } = await keyRes.json();
              const convertedKey = urlBase64ToUint8Array(publicKey);
              const newSub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedKey as unknown as BufferSource,
              });
              const subJson = newSub.toJSON();
              await fetch("/api/notifications/push/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  endpoint: subJson.endpoint,
                  keys: subJson.keys,
                  userAgent: navigator.userAgent,
                  platform: iosDevice ? "iOS" : /Android/i.test(ua) ? "Android" : "Web",
                }),
              }).catch(() => {});
            }
          }
        } catch {}
      }).catch(() => {});
      return;
    }

    // Check 3-day dismissal cooldown (max 3 dismissals)
    try {
      const dismissCount = parseInt(localStorage.getItem("srt_notif_dismiss_count") || "0", 10);
      const dismissUntil = parseInt(localStorage.getItem("srt_notif_dismiss_until") || "0", 10);
      if (dismissCount >= 3 || Date.now() < dismissUntil) {
        return;
      }
    } catch {}

    // Listen for custom trigger from login or install flow
    const handleOpenFromEvent = () => {
      setIsOpen(true);
      setShowFloatingPill(false);
    };

    window.addEventListener("open-notification-prompt", handleOpenFromEvent);

    // Auto-prompt on portal open after a brief delay
    const isLogin = window.location.pathname.startsWith("/login") || window.location.pathname === "/";
    const timer = setTimeout(() => {
      setIsOpen(true);
      setShowFloatingPill(false);
    }, isLogin ? 2200 : 1200);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("open-notification-prompt", handleOpenFromEvent);
    };
  }, []);

  const handleDismiss = () => {
    try {
      if (isIOS && !isStandalone) {
        localStorage.setItem("srt_ios_install_prompt_dismiss", String(Date.now() + 3 * 24 * 60 * 60 * 1000));
      } else {
        const currentCount = parseInt(localStorage.getItem("srt_notif_dismiss_count") || "0", 10);
        localStorage.setItem("srt_notif_dismiss_count", String(currentCount + 1));
        localStorage.setItem("srt_notif_dismiss_until", String(Date.now() + 3 * 24 * 60 * 60 * 1000));
      }
    } catch {}
    setIsOpen(false);
    setShowFloatingPill(false);
  };

  const handleOpenPrompt = () => {
    setErrorMsg(null);
    setIsOpen(true);
    setShowFloatingPill(false);
  };

  const handleCheckAgain = async () => {
    if (typeof Notification !== "undefined") {
      setPermission(Notification.permission);
      if (Notification.permission === "granted") {
        await handleEnableNotifications();
      }
    }
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
            ? "Notifications are blocked. Please tap the lock/tune icon in your address bar and change Notifications to 'Allow'."
            : "Notification permission was not granted."
        );
        return;
      }

      // 2. Register / retrieve active Service Worker
      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      }
      await navigator.serviceWorker.ready;

      // 3. Fetch VAPID Public Key from canonical endpoint
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
        platform: isIOS ? "iOS" : /Android/i.test(navigator.userAgent) ? "Android" : "Web",
        browser: browserName,
        deviceName: `${browserName} on ${isIOS ? "iPhone" : /Android/i.test(navigator.userAgent) ? "Android" : "Desktop"}`,
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

      // 6. Send immediate test confirmation push to this device
      fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "🔔 Notifications Enabled!",
          message: "You will now receive instant messages, attendance updates, and announcements.",
        }),
      }).catch(() => {});

      setIsSuccess(true);
      setLoading(false);
      setShowFloatingPill(false);

      // Auto-close after showing success
      setTimeout(() => {
        setIsOpen(false);
      }, 2200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error enabling notifications.";
      console.error("[PwaWelcome] Enable push error:", err);
      setErrorMsg(msg);
      setLoading(false);
    }
  }, [isIOS, browserName]);

  // If already granted, don't show prompt
  if (permission === "granted") {
    return null;
  }

  return (
    <>
      {/* Floating Action Pill */}
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

            {/* Circular Bell Icon */}
            <div className={styles.iconContainer}>
              <div className={styles.iconOuterRing}>
                <div className={styles.iconInnerCircle}>
                  <Bell size={24} className={styles.bellIcon} />
                </div>
              </div>
            </div>

            {/* Content Area */}
            <div className={styles.contentArea}>
              <h3 id="welcome-notif-title" className={styles.title}>
                {isIOS && !isStandalone ? "Enable iPhone Notifications" : "Stay in the loop"}
              </h3>
              <p className={styles.desc}>
                {isIOS && !isStandalone 
                  ? "To receive push notifications on iPhone / iPad, Apple requires adding the portal to your Home Screen first."
                  : "Get timely updates for student messages, attendance, bus tracking, and announcements."}
              </p>

              {/* iOS Safari Step-by-Step Instructions */}
              {isIOS && !isStandalone && (
                <div style={{
                  backgroundColor: "rgba(99, 102, 241, 0.08)",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  margin: "12px 0",
                  textAlign: "left",
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  color: "var(--foreground, #1e293b)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Share2 size={16} color="#6366f1" style={{ flexShrink: 0 }} />
                    <span><strong>1.</strong> Tap the <strong>Share</strong> button at the bottom of Safari.</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <PlusSquare size={16} color="#6366f1" style={{ flexShrink: 0 }} />
                    <span><strong>2.</strong> Scroll down and tap <strong>Add to Home Screen</strong>.</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Smartphone size={16} color="#6366f1" style={{ flexShrink: 0 }} />
                    <span><strong>3.</strong> Open <strong>SRT Portal</strong> from your Home Screen to enable alerts!</span>
                  </div>
                </div>
              )}

              {/* Denied Alert with instructions */}
              {permission === "denied" && (
                <div className={styles.deniedAlert}>
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>Notifications are blocked in {browserName}</div>
                    <div style={{ fontSize: "0.78rem", marginTop: "2px", opacity: 0.9 }}>
                      Tap the lock or tune icon in your address bar, set Notifications to <strong>Allow</strong>, then tap Check Again below.
                    </div>
                  </div>
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

            {/* Actions */}
            {!isSuccess && (
              <div className={styles.actions}>
                {isIOS && !isStandalone ? (
                  <button
                    type="button"
                    className={styles.enableBtn}
                    onClick={handleDismiss}
                  >
                    <span>Got it, I'll add to Home Screen</span>
                  </button>
                ) : permission === "denied" ? (
                  <button
                    type="button"
                    className={styles.enableBtn}
                    onClick={handleCheckAgain}
                  >
                    <RefreshCw size={16} />
                    <span>Check again</span>
                  </button>
                ) : (
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
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
