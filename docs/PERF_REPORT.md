# SRT Universal School Management Portal — Performance & Keep-Alive Report

## 1. Hosting Architecture & Cold Start Mitigation
- **Frontend**: Vercel Serverless (`bom1` Mumbai region for fastest Indian phone latency).
- **Backend**: Render Web Service (`https://nipoportal-dev.onrender.com`).
- **Database Pooler**: Supabase transaction mode pooler (port 6543 with `pgbouncer=true&connection_limit=1`), eliminating `EMAXCONNSESSION` pool exhaustion.

---

## 2. Keep-Alive & Warmup Daemon
- **GitHub Actions Scheduled Workflow**: `.github/workflows/keep-alive.yml` runs every 5 minutes in GitHub's cloud.
- **Targets**:
  1. Render backend liveness: `https://nipoportal-dev.onrender.com/api/health/live` (0 database queries, responds in <700ms).
  2. Vercel frontend warmup: `https://nipoportal.vercel.app/api/warmup`.
  3. Outbox queue processor: `https://nipoportal.vercel.app/api/notifications/outbox/process`.

---

## 3. Straight-To-Dashboard Navigation
- **Zero Splash on Login**: Removed full-screen "Loading your dashboard..." splash and spinning logo.
- **Edge Server Redirect**: `proxy.ts` inspects session tokens on `/`, `/login`, and `/dashboard`, redirecting immediately to `/dashboard/{role}` at the edge.
- **Client Route Transitions**: `ModernLoginForm.tsx` pre-warms the target role dashboard and calls `router.replace(target)`.
- **Skeleton Placeholders**: Route suspense boundaries in `loading.tsx` and `dashboard/loading.tsx` use non-blocking skeleton cards instead of full-screen loading blockers.
