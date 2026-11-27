"use client";

import OneSignal from "react-onesignal";

export const ONESIGNAL_APP_ID =
  process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID ||
  "63a34381-365f-40d4-b3ed-244c408f7243";

let isInitialized = false;
let initPromise: Promise<void> | null = null;
let currentLoggedInUserId: string | null = null;
let inFlightLoginPromise: Promise<boolean> | null = null;

/**
 * Initialize OneSignal Web SDK v16 once per browser session
 */
export async function initOneSignal(): Promise<void> {
  if (typeof window === "undefined") return;
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const win = window as any;
      if (win.OneSignal && (win.OneSignal.User || win.OneSignal._isInitialized)) {
        isInitialized = true;
        return;
      }

      const safariWebId = process.env.NEXT_PUBLIC_ONESIGNAL_SAFARI_WEB_ID;
      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        ...(safariWebId ? { safari_web_id: safariWebId } : {}),
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerParam: { scope: "/" },
        serviceWorkerPath: "/OneSignalSDKWorker.js",
      });
      isInitialized = true;
      console.log("[OneSignal] Initialized with App ID:", ONESIGNAL_APP_ID);
    } catch (err: any) {
      if (err?.message?.includes("already initialized") || String(err).includes("already initialized")) {
        isInitialized = true;
      } else {
        initPromise = null;
        console.warn("[OneSignal] Initialization note:", err);
      }
    }
  })();

  return initPromise;
}

export interface OneSignalSubscriptionState {
  externalId: string | null;
  subscriptionId: string | null;
  optedIn: boolean;
  permission: NotificationPermission;
}

/**
 * Read non-secret OneSignal Web SDK v16 subscription state for diagnostics.
 */
export function getOneSignalSubscriptionState(): OneSignalSubscriptionState {
  if (typeof window === "undefined") {
    return { externalId: null, subscriptionId: null, optedIn: false, permission: "default" };
  }
  const win = window as any;
  const osInstance = win.OneSignal || OneSignal;
  const permission: NotificationPermission =
    typeof Notification !== "undefined" ? Notification.permission : "default";
  return {
    externalId: (osInstance?.User?.externalId as string | undefined) || null,
    subscriptionId: (osInstance?.User?.PushSubscription?.id as string | undefined) || null,
    optedIn: Boolean(osInstance?.User?.PushSubscription?.optedIn),
    permission,
  };
}

/**
 * Link the logged-in user's device directly to their PostgreSQL user.id (external_id)
 * Guarded: calls init once, runs login once per session, and deduplicates parallel requests
 */
export async function loginToOneSignal(userId: string): Promise<boolean> {
  if (typeof window === "undefined" || !userId) return false;
  const cleanId = String(userId).trim();
  if (!cleanId) return false;

  // Once-per-session guard: If already logged in as this user, don't repeat
  if (currentLoggedInUserId === cleanId) {
    return true;
  }

  // Prevent duplicate parallel login calls
  if (inFlightLoginPromise) {
    return inFlightLoginPromise;
  }

  inFlightLoginPromise = (async () => {
    try {
      await initOneSignal();
      const win = window as any;
      const osInstance = win.OneSignal || OneSignal;

      if (osInstance && typeof osInstance.login === "function") {
        await osInstance.login(cleanId);
        currentLoggedInUserId = cleanId;
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted" &&
          osInstance.User?.PushSubscription &&
          !osInstance.User.PushSubscription.optedIn &&
          typeof osInstance.User.PushSubscription.optIn === "function"
        ) {
          await osInstance.User.PushSubscription.optIn().catch((optErr: unknown) => {
            console.warn("[OneSignal] PushSubscription.optIn warning:", optErr);
          });
        }
        console.log("[OneSignal] User linked:", {
          external_id: cleanId,
          ...getOneSignalSubscriptionState(),
        });
        return true;
      }
      return false;
    } catch (err: any) {
      // Catch internal OneSignal SDK language/translation undefined property gracefully
      if (
        err?.message?.includes("Cannot read properties of undefined (reading 'en')") ||
        String(err).includes("reading 'en'")
      ) {
        currentLoggedInUserId = cleanId;
        return true;
      }
      console.warn("[OneSignal] Login link warning:", err);
      return false;
    } finally {
      inFlightLoginPromise = null;
    }
  })();

  return inFlightLoginPromise;
}

/**
 * Unlink device on logout
 */
export async function logoutFromOneSignal(): Promise<void> {
  if (typeof window === "undefined") return;
  currentLoggedInUserId = null;
  inFlightLoginPromise = null;

  try {
    const win = window as any;
    if (win.OneSignal && typeof win.OneSignal.logout === "function") {
      await win.OneSignal.logout();
    } else if (isInitialized) {
      await OneSignal.logout();
    }
  } catch (err) {
    console.debug("[OneSignal] Logout warning:", err);
  }
}

/**
 * Request notification permission via OneSignal Native Prompt
 */
export async function requestOneSignalPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    await initOneSignal();
    const win = window as any;
    const osInstance = win.OneSignal || OneSignal;
    if (osInstance?.Notifications && typeof osInstance.Notifications.requestPermission === "function") {
      await osInstance.Notifications.requestPermission();
    } else if (typeof Notification !== "undefined" && Notification.requestPermission) {
      await Notification.requestPermission();
    }
    const granted =
      Boolean(osInstance?.Notifications?.permission) ||
      (typeof Notification !== "undefined" && Notification.permission === "granted");
    if (
      granted &&
      osInstance?.User?.PushSubscription &&
      !osInstance.User.PushSubscription.optedIn &&
      typeof osInstance.User.PushSubscription.optIn === "function"
    ) {
      await osInstance.User.PushSubscription.optIn().catch((optErr: unknown) => {
        console.warn("[OneSignal] PushSubscription.optIn warning:", optErr);
      });
    }
    console.log("[OneSignal] Permission & subscription state:", getOneSignalSubscriptionState());
    return granted;
  } catch (err) {
    console.warn("[OneSignal] Request permission error:", err);
    return false;
  }
}

/**
 * Prompt user via OneSignal Slidedown banner
 */
export async function promptOneSignalSlidedown(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await initOneSignal();
    const win = window as any;
    if (win.OneSignal && win.OneSignal.Slidedown && typeof win.OneSignal.Slidedown.promptPush === "function") {
      await win.OneSignal.Slidedown.promptPush();
      return;
    }
    await OneSignal.Slidedown.promptPush();
  } catch (err) {
    console.warn("[OneSignal] Slidedown prompt error:", err);
  }
}

/**
 * Check if permission is currently granted
 */
export function hasOneSignalPermission(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      return true;
    }
    const win = window as any;
    if (win.OneSignal && win.OneSignal.Notifications) {
      return Boolean(win.OneSignal.Notifications.permission);
    }
    return Boolean(OneSignal.Notifications.permission);
  } catch {
    return false;
  }
}

export default OneSignal;
