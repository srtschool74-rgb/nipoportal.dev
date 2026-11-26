"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { 
  Bell, 
  MessageSquare, 
  Bus, 
  Award, 
  AlertTriangle, 
  X, 
  ExternalLink,
  Calendar,
  BookOpen,
  Info
} from "lucide-react";

interface InAppToast {
  id: string;
  title: string;
  body: string;
  type?: string;
  category?: string;
  priority?: string;
  link?: string;
  image?: string;
  createdAt?: string | Date;
}

export default function DashboardNotificationToaster() {
  const router = useRouter();
  const [toasts, setToasts] = useState<InAppToast[]>([]);
  const [totalUnseen, setTotalUnseen] = useState<number>(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const isFetchingRef = useRef(false);

  // Helper to fetch unseen notifications from server
  const fetchUnseenNotifications = useCallback(async () => {
    if (isFetchingRef.current || typeof window === "undefined") return;
    isFetchingRef.current = true;

    try {
      const res = await fetch("/api/notifications/unseen", {
        cache: "no-store",
      });

      if (!res.ok) return;

      const data = await res.json();
      if (!data?.success || !Array.isArray(data.notifications)) return;

      const incoming: InAppToast[] = data.notifications;
      const filtered = incoming.filter((n) => !seenIdsRef.current.has(n.id));

      if (filtered.length > 0) {
        filtered.forEach((n) => seenIdsRef.current.add(n.id));

        setToasts((prev) => {
          const merged = [...filtered, ...prev];
          // Deduplicate by ID
          const seen = new Set<string>();
          return merged.filter((item) => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });
        });

        setTotalUnseen(data.totalUnseen || filtered.length);
      }
    } catch (err) {
      console.debug("[NotificationToaster] Fetch note:", err);
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  // Listen to Lifecycle Events: Initial Mount, Window Focus, Visibility Change, Online, and SW Message
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Initial fetch after a brief delay
    const initialTimer = setTimeout(() => {
      fetchUnseenNotifications();
    }, 1200);

    // 2. Tab focus & visibility change
    const onVisibilityChange = () => {
      if (!document.hidden) {
        fetchUnseenNotifications();
      }
    };

    const onFocus = () => {
      fetchUnseenNotifications();
    };

    const onOnline = () => {
      fetchUnseenNotifications();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    // 3. Foreground WebPush / Service Worker Event
    const onSwMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === "FOREGROUND_NOTIFICATION") {
        const notif = event.data.notification;
        if (notif && notif.id && !seenIdsRef.current.has(notif.id)) {
          seenIdsRef.current.add(notif.id);
          setToasts((prev) => [
            {
              id: notif.id,
              title: notif.title || "New Notification",
              body: notif.body || "",
              link: notif.url || "/dashboard",
              image: notif.image,
              priority: notif.priority || "HIGH",
            },
            ...prev,
          ]);
        }
      }
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onSwMessage);
    }

    return () => {
      clearTimeout(initialTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onSwMessage);
      }
    };
  }, [fetchUnseenNotifications]);

  // Auto-dismiss toasts after 6 seconds (or 12s if URGENT/HIGH)
  useEffect(() => {
    if (toasts.length === 0) return;

    const timers = toasts.map((toast) => {
      const duration = toast.priority === "URGENT" || toast.priority === "HIGH" ? 10000 : 6000;
      return setTimeout(() => {
        handleDismiss(toast.id);
      }, duration);
    });

    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [toasts]);

  const handleDismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleToastClick = async (toast: InAppToast) => {
    handleDismiss(toast.id);

    // Mark as read in background
    if (toast.id) {
      fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: toast.id }),
      }).catch(() => {});
    }

    if (toast.link) {
      router.push(toast.link);
    }
  };

  if (toasts.length === 0) {
    return null;
  }

  // Cap at 3 visible elements: up to 2 cards + 1 summary card, or 3 cards
  const showSummary = toasts.length > 3 || totalUnseen > 3;
  const visibleToasts = showSummary ? toasts.slice(0, 2) : toasts.slice(0, 3);
  const remainingCount = (totalUnseen > toasts.length ? totalUnseen : toasts.length) - visibleToasts.length;

  const getIcon = (type?: string, category?: string) => {
    const key = (type || category || "").toUpperCase();
    if (key.includes("MESSAGE")) return <MessageSquare size={18} color="#3b82f6" />;
    if (key.includes("BUS")) return <Bus size={18} color="#eab308" />;
    if (key.includes("REPORT") || key.includes("MARKS")) return <Award size={18} color="#10b981" />;
    if (key.includes("HOMEWORK") || key.includes("ASSIGNMENT")) return <BookOpen size={18} color="#8b5cf6" />;
    if (key.includes("CALENDAR") || key.includes("ATTENDANCE")) return <Calendar size={18} color="#f97316" />;
    if (key.includes("URGENT") || key.includes("ALERT")) return <AlertTriangle size={18} color="#ef4444" />;
    return <Bell size={18} color="#6366f1" />;
  };

  return (
    <div
      style={{
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxWidth: "380px",
        width: "calc(100% - 32px)",
        pointerEvents: "none",
      }}
    >
      {visibleToasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => handleToastClick(toast)}
          style={{
            pointerEvents: "auto",
            backgroundColor: "var(--card-bg, #ffffff)",
            color: "var(--foreground, #1e293b)",
            border: "1px solid var(--border-color, #e2e8f0)",
            borderRadius: "14px",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06)",
            padding: "12px 14px",
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            cursor: "pointer",
            transition: "transform 0.15s ease, box-shadow 0.15s ease",
            backdropFilter: "blur(12px)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
        >
          {/* Category Icon */}
          <div
            style={{
              padding: "6px",
              borderRadius: "10px",
              backgroundColor: "rgba(99, 102, 241, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {getIcon(toast.type, toast.category)}
          </div>

          {/* Body Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4
              style={{
                margin: "0 0 3px 0",
                fontSize: "0.88rem",
                fontWeight: 600,
                lineHeight: 1.3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {toast.title}
            </h4>
            <p
              style={{
                margin: 0,
                fontSize: "0.8rem",
                lineHeight: 1.35,
                color: "var(--text-secondary, #64748b)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {toast.body}
            </p>
          </div>

          {/* Optional Image Thumbnail */}
          {toast.image && (
            <img
              src={toast.image}
              alt="Preview"
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "8px",
                objectFit: "cover",
                flexShrink: 0,
              }}
            />
          )}

          {/* Close Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleDismiss(toast.id);
            }}
            style={{
              background: "none",
              border: "none",
              padding: "2px",
              color: "var(--text-secondary, #94a3b8)",
              cursor: "pointer",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            title="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      ))}

      {/* Summary Card for Remaining Notifications */}
      {showSummary && remainingCount > 0 && (
        <div
          onClick={() => {
            setToasts([]);
            router.push("/notifications");
          }}
          style={{
            pointerEvents: "auto",
            backgroundColor: "var(--primary, #6366f1)",
            color: "#ffffff",
            borderRadius: "12px",
            padding: "9px 14px",
            boxShadow: "0 6px 18px rgba(99, 102, 241, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            fontSize: "0.82rem",
            fontWeight: 600,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Bell size={15} />
            <span>You have {remainingCount} more new notification{remainingCount > 1 ? "s" : ""}</span>
          </div>
          <span style={{ display: "flex", alignItems: "center", gap: "3px", textDecoration: "underline", fontSize: "0.75rem" }}>
            View all <ExternalLink size={11} />
          </span>
        </div>
      )}
    </div>
  );
}
