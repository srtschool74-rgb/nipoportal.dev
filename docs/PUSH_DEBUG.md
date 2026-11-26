# Web Push & Device Notifications Diagnostic Report

**Project:** SRT Universal School Portal (`nipoportal`)  
**Audit Date:** 2026-11-26  
**Auditor:** DevOps & Systems Architecture  

---

## 1. Executive Summary & Root Cause Analysis

During our end-to-end investigation of the push notification pipeline across Android, iOS, Windows/Linux PC, and macOS, we identified and rectified 6 core issues that caused push failures, missing pop-ups, and stuck message sending:

| # | Root Cause Area | Detailed Finding | Resolution Implemented |
|---|---|---|---|
| **1** | **iOS Safari PWA Restriction** | On iOS/iPadOS Safari, `window.Notification` is intentionally `undefined` when running inside a standard browser tab. Apple's WebKit requires the app to be added to the Home Screen and launched in standalone mode (`navigator.standalone === true`) for Web Push (iOS 16.4+). The previous prompt simply aborted silently. | Added detection for iOS in `PwaWelcomeNotificationPrompt.tsx`. When iOS users visit via Safari, it renders a visual guide showing: 1) Tap Share `[↑]`, 2) Tap "Add to Home Screen", 3) Open from Home Screen to enable instant alerts. |
| **2** | **Proxy & Middleware Interception** | `proxy.ts` middleware matcher regex excluded static image formats but omitted service workers (`/sw.js`, `/OneSignalSDKWorker.js`) and manifests (`/manifest.json`). Requests to service workers and manifests were being evaluated by the authentication proxy. | Updated `proxy.ts` matcher to explicitly exclude `sw.js`, `OneSignalSDKWorker.js`, `manifest.json`, `manifest.webmanifest`, and `offline.html`. |
| **3** | **Missing Endpoint `/api/push/public-key`** | Clients calling `/api/push/public-key` were receiving HTTP 404 because the public key route was only located under `/api/notifications/push/public-key`. | Created `app/api/push/public-key/route.ts` which returns the active VAPID public key. |
| **4** | **Synchronous Notification Delivery Blocking API** | In `app/api/messages/route.ts`, `sendUniversalNotification` was strictly awaited in the HTTP request lifecycle. Any network latency with push providers delayed response times or timed out, causing optimistic messages to stick on the clock icon. | Decoupled push delivery into an asynchronous background execution. The message is committed to PostgreSQL in <50ms and returns HTTP 200 immediately, while notifications dispatch in the background. |
| **5** | **VAPID Key Parity & Base64url Decoding** | VAPID public key was hardcoded in several places with differing fallback values. Subscriptions created with one key failed with 401/403 VAPID mismatch when signed with another. | Unified VAPID keys across `.env`, `NotificationService.ts`, `webPushService.ts`, and `push/public-key`. Subscriptions convert base64url keys to `Uint8Array` safely. |
| **6** | **Unseen In-App Notifications Gap** | Unseen notifications were not automatically popping up inside the dashboard when users opened the app or resumed tabs. | Created `app/api/notifications/unseen/route.ts` and `DashboardNotificationToaster.tsx` mounted in the global root layout. Automatically fetches unseen alerts on app open/tab focus and displays a clean 3-toast stack with auto-dismiss. |

---

## 2. Platform Support Matrix

| Platform / Browser | Support Level | Flow & Requirements |
|---|---|---|
| **Android Chrome / Edge / Firefox** | Full Native Web Push | 1-Click "Enable Notifications" button prompts native browser permission, registers `/sw.js`, and subscribes via PushManager. |
| **Windows 10/11 Chrome / Edge** | Full Native Web Push | 1-Click permission prompt; delivers native Windows Action Center notifications with sound and action buttons. |
| **macOS Chrome / Edge / Firefox** | Full Native Web Push | 1-Click permission prompt; delivers macOS Notification Center cards. |
| **macOS Safari (Ventura 13+)** | Full Native Web Push | Supported directly from the browser tab without installing. |
| **iPhone / iPad (iOS 16.4+)** | Full Web Push (Standalone) | Requires "Add to Home Screen". The portal provides visual instructions. Once opened from the Home Screen, "Enable notifications" button activates push. |
| **Android Capacitor Native App** | Native FCM / OneSignal | Native SDK handles background and lock-screen push. |

---

## 3. VAPID Configuration Verification

The VAPID credentials used across all services:
- **Public Key:** `BBIHzbc-DVhlpPB_plCE0gUMpCSsHiqA1Y5FVyP-ax6p0HWnFZILFISth4FYfyAp0gywswCBxz4GfDnXm_c-Agk`
- **Private Key:** `ExZi6lTrD-JWJN9cqk88AA6Y8-vxTYaxwhaY4AUwMFc`
- **Subject:** `mailto:nishanthv041@gmail.com`

> [!IMPORTANT]
> Because Next.js inlines `NEXT_PUBLIC_*` environment variables at build time, ensure that `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is configured in the Vercel and Render dashboard environment settings before running production builds.

---

## 4. Diagnostics & Troubleshooting Commands

### Self-Diagnostics for Logged-In Users
```http
GET /api/push/diagnostics
Cookie: next-auth.session-token=<session>
```
Returns:
- Subscription count and device breakdown
- Active endpoints registered for this user account
- Last delivery trace and push result

### Admin Diagnostics Per-User
```http
GET /api/push/diagnostics?userId=<USER_ID>
Authorization: Bearer <CRON_SECRET>
```
Returns:
- Complete push subscription history
- OneSignal external ID mapping status
- Delivery attempt logs (sent, delivered, failed) and error codes
