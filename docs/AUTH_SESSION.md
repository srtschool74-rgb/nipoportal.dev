# SRT Universal School Management Portal — Authentication & Session Architecture

## 1. Overview & Core Directives
This document outlines the authentication and session management design for the SRT Universal School Portal (`nipoportal`), deployed on Vercel (`https://nipoportal.vercel.app`) and Render (`https://nipoportal-dev.onrender.com`).

### Core Rules
- **Parent & Teacher Accounts**: Indefinite sliding login (365 days / 10 years). Users remain authenticated permanently without unexpected logouts.
- **Admin Accounts**: Enforce an idle timeout setting in Admin Settings with a default of 7 days (168 hours).
- **Single-Device Mode**: Active by default for Parents and Teachers (`SINGLE_DEVICE_ROLES = ["PARENT", "TEACHER"]`). When a user signs in on a second phone, their prior session is terminated with `LOGIN_ELSEWHERE`, alerting the user on the previous device.
- **Accidental Logout Prevention**: Network drops, fetch timeouts, and HTTP 5xx responses never terminate sessions. Only an explicit server 401 with a recognized revocation reason (`LOGIN_ELSEWHERE`, `ADMIN_FORCED`, `PASSWORD_CHANGED`, `LOGOUT`) may terminate a session.

---

## 2. Session Lifecycle & Token Management
1. **JWT Strategy**: NextAuth tokens are signed with `NEXTAUTH_SECRET` and cookie `maxAge = 315,360,000` (10 years).
2. **Sliding Window**: `SilentSessionRefresher.tsx` touches `/api/auth/session` in the background every 3 hours and on window focus if more than 2 hours elapsed. On native mobile (Capacitor), credentials persist in `@capacitor/preferences`.
3. **Session Verification**: `SessionGuard.tsx` polls `/api/auth/session-status` every 60 seconds with active user deduplication (throttled when phone screen is locked or document is hidden).

---

## 3. Google OAuth Single Sign-On (SSO)
- **Universal Availability**: Available to all roles (Parents, Teachers, Staff, Students, and Admins).
- **Auto-Provisioning**: If an authorized Google email is not yet registered in `prisma.user`, it is automatically provisioned as an active `PARENT` account, preventing `AccessDenied` errors.
- **Role Redirection**: Server Edge middleware (`proxy.ts`) immediately redirects authenticated Google users straight to `/dashboard/{role}` with 0ms intermediate delay.

---

## 4. Multi-Device Revocation Controls
- **"Log out of all devices" Action**: Exposed in user profile and admin settings via `logoutAllDevicesAction()`. Revokes all active database sessions in `prisma.userSession`.
- **Active Devices List**: Queries active sessions (`getUserSessionsAction()`) showing device user-agent, IP address, creation time, and last active timestamp.
