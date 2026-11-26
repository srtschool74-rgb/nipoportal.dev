# SRT Universal School Management Portal — Progressive Web App (PWA)

## 1. Lighthouse PWA Compliance
The portal is fully optimized as an installable Progressive Web App (PWA):
1. **Web App Manifest** (`public/manifest.json`):
   - `start_url`: `/dashboard` (direct role-based server edge redirect).
   - `background_color`: `#060a28` (seamless deep blue system splash window).
   - `theme_color`: `#060a28`.
   - `display`: `standalone` (with `window-controls-overlay` and `minimal-ui` fallbacks).
   - Standard 192x192 and 512x512 icons (any & maskable) + Apple touch icons.
2. **Service Worker**:
   - `OneSignalSDKWorker.js` registered with root scope (`/`).
   - Handles push notifications, notification click routing, and offline asset caching.

---

## 2. In-Page Pop-Up Sequence
To ensure optimal user onboarding and prevent modal conflicts, pop-ups follow a strict non-blocking sequence:
1. **First Pop-up**: "Stay in the loop" (Notification Permission Prompt)
   - Explains real benefits: instant attendance, exam notifications, homework, fee updates.
   - Single clean primary button: "Enable notifications".
   - **No "Maybe later" button** anywhere.
2. **Second Pop-up**: "Install SRT App"
   - Appears only after the notification prompt is answered or closed.
   - Provides native install guidance for Android Chrome, iOS Safari ("Add to Home Screen"), and Desktop.
3. **Cooldown & Preference Tracking**:
   - If dismissed, prompts enter a 3-day cooldown.
   - Prompts are permanently suppressed after 3 dismissals.
   - Neither prompt is displayed if permission is already granted or if the user is already in `standalone` display mode.
