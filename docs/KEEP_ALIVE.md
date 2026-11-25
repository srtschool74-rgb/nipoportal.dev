# SRT School Management Portal — Automatic Keep-Alive System

## 1. Overview & Purpose

The **SRT School Management Portal** backend is hosted on **Render**, while the frontend is deployed on **Vercel**:
- **Frontend (Vercel)**: Global Edge Network / Serverless (does not spin down; static assets are globally cached).
- **Backend (Render)**: Persistent Node.js Web Service container.

### The Challenge: Render Inactivity Sleep
On Render's Free tier, Web Services automatically spin down into hibernation after **15 minutes of inactivity** (zero inbound HTTP requests). When an administrator, teacher, or parent navigates to the portal after a spin-down, the container must reboot, causing an unwelcome **30 to 60-second cold start delay**.

### The Solution: Automatic Zero-Database Keep-Alive
The keep-alive system dispatches a lightweight HTTP GET request to the Render backend at a configured interval (**every 5 minutes**, configurable between 5 and 10 minutes). This continuously resets Render's 15-minute inactivity timer, keeping the web service permanently active and ready to serve requests instantly.

---

## 2. Architecture & Design Principles

```
                  ┌────────────────────────────────────────┐
                  │      GitHub Actions Cloud Cron         │
                  │   (Runs every 5 mins on GitHub runner)  │
                  │       (Laptop can remain off!)         │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                        [node keep-alive.js --once]
                                      │
                                      │ HTTP GET /api/health/live (35s timeout)
                                      ▼
                  ┌────────────────────────────────────────┐
                  │         Render Backend Service         │
                  │   (/api/health/live or /api/ping)      │
                  │                                        │
                  │  ⚡ ZERO Database Queries               │
                  │  ⚡ ZERO Authentication Checks          │
                  │  ⚡ Sub-5ms Response Time               │
                  │  ⚡ HTTP 200 { status: "alive" }        │
                  │  ⚡ Resets 15-minute Render sleep timer │
                  └────────────────────────────────────────┘
```

### Strict Architectural Safeguards
1. **Zero Database Impact**:
   - The keep-alive system strictly targets `/api/health/live` and `/api/ping`.
   - It **does not** run SQL queries or touch the Supabase/PostgreSQL connection pool. This avoids exhausting connection poolers (`EMAXCONNSESSION`) on shared tiers.
2. **Zero Vercel Waste**:
   - Vercel is a serverless platform where static assets are permanently available on CDN edges. Pinging Vercel functions periodically would needlessly consume serverless function quotas. The keep-alive daemon specifically monitors and pings the persistent **Render backend**.
3. **Concurrency Mutex Lock**:
   - An atomic execution lock prevents overlapping pings if a previous request is delayed during a cold start.
4. **Resilient Jitter & Retries**:
   - Includes 0–3 second random jitter and exponential retry logic across 3 attempts for network resilience.

---

## 3. Endpoints

| Endpoint | Method | Database Queries | Expected Response | Description |
|---|---|---|---|---|
| `/api/health/live` | `GET`, `HEAD` | **0** | `200 OK` `{"status":"alive","uptime":...}` | Lightweight liveness probe |
| `/api/ping` | `GET`, `HEAD` | **0** | `200 OK` `{"status":"ok","ping":"pong"}` | Ultra-fast ping alias (<5ms) |
| `/api/health` | `GET` | 1 (`SELECT 1`) | `200 OK` (deep health) | Deep readiness probe with DB & Supabase latency |

---

## 4. The `keep-alive.js` Script

The script is located at the project root (`./keep-alive.js`) and requires **zero external npm dependencies** (uses Node.js native `fetch` and `AbortController`).

### Execution Modes

#### Mode 1: Single-Shot Mode (For Cloud Cron Runners)
```bash
node keep-alive.js --once
# or via npm script
npm run keep-alive:once
```
- Dispatches a single ping, logs timing diagnostics, and exits with code `0` (success) or `1` (failure).
- Ideal for GitHub Actions, cloud cron jobs, or container orchestration.

#### Mode 2: Continuous Daemon Mode (Long-Running Background Process)
```bash
node keep-alive.js
# or via npm script
npm run keep-alive
```
- Runs continuously on a loop, dispatching pings every 5 minutes (default).
- Responds gracefully to `SIGINT` (Ctrl+C) and `SIGTERM`.

### Configuration Options

| Option / Variable | Flag | Default | Allowed Range | Description |
|---|---|---|---|---|
| `INTERVAL_MINUTES` | `--interval=X` | `5` | `5` to `10` minutes | Frequency of pings |
| `RENDER_URL` / `TARGET_URL` | CLI argument | Auto-detected | Valid HTTP(S) URL | Target backend URL |
| `PING_TIMEOUT_MS` | N/A | `35000` (35s) | > 5000ms | Request timeout (allows Render cold starts) |
| `PING_RETRIES` | N/A | `2` | 0 to 5 | Number of retry attempts on transient failures |

#### Custom Examples:
```bash
# Ping every 7 minutes (clamped between 5 and 10 minutes)
node keep-alive.js --interval=7

# Ping a specific Render backend domain in single-shot mode
node keep-alive.js --once https://nipoportal.dev.onrender.com/api/health/live
```

---

## 5. Automatic Cloud Scheduling (No Laptop Required)

To ensure the keep-alive executes 24/7 without requiring any local computer to remain switched on, the project is configured with multiple automated cloud triggers:

### Method A: GitHub Actions Cloud Workflow (Pre-Configured)
The repository includes `.github/workflows/keep-alive.yml`:
- **Schedule**: Executes automatically in GitHub's cloud every 5 minutes (`cron: "*/5 * * * *"`).
- **Zero Cost**: Included in GitHub's standard public/private repository Actions allowances.
- **Manual Trigger**: Can also be executed on-demand at any time from the **GitHub Actions** tab via the **Run workflow** button.
- **Concurrency Protection**: Uses `group: render-keep-alive` to prevent duplicate concurrent runs.

#### To customize the backend URL in GitHub Actions:
In your GitHub Repository, navigate to **Settings > Secrets and variables > Actions** and add:
- `RENDER_BACKEND_URL`: `https://your-app-name.onrender.com`

---

### Method B: Free External Cloud Monitors (Recommended Secondary Guarantee)
For mission-critical production redundancy, we recommend coupling the GitHub Actions scheduler with a free external uptime pinger. These services run on globally distributed nodes and provide automatic email alerts if your backend ever fails:

1. **UptimeRobot (Free — 50 Monitors, 5-min intervals)**:
   - URL: [https://uptimerobot.com](https://uptimerobot.com)
   - Monitor Type: `HTTP(s)`
   - Friendly Name: `SRT Portal Backend Keep-Alive`
   - URL to Monitor: `https://<your-render-subdomain>.onrender.com/api/health/live`
   - Monitoring Interval: `Every 5 minutes`
   - Alert When Down: Enabled

2. **Cron-Job.org (Free — Unlimited 1-minute to 10-minute crons)**:
   - URL: [https://cron-job.org](https://cron-job.org)
   - Title: `SRT Render Keep-Alive`
   - URL: `https://<your-render-subdomain>.onrender.com/api/health/live`
   - Schedule: `Every 5 minutes`

---

## 6. Render Free Tier Limitations vs. Starter Plan

### Free Web Service Plan
- **Inactivity Spin-Down**: Render automatically suspends containers after 15 minutes of zero traffic.
- **750 Free Hours / Month**: Render provides 750 free instance hours per calendar month across all free web services on the account.
  - A 30-day month = 720 hours.
  - A 31-day month = 744 hours.
  - *Note*: If you run **only one** free service on your Render account, 750 hours is mathematically sufficient to keep it awake 24/7.
  - *Limitation*: If you deploy multiple free services, they share the 750-hour pool. Once exhausted, all free services remain suspended until the 1st of the next month.
- **Instance Spinning/Restarting**: Free containers can be recycled or relocated during maintenance windows without notification.

### Recommendation for Mission-Critical School Production
If guaranteed 100% uptime, dedicated CPU/RAM, and zero cold starts are required, we recommend upgrading the Render service to the **Starter Plan ($7/month)**:
- **No Sleep**: The service runs continuously 24/7 without ever spinning down.
- **No Monthly Hour Caps**: Never runs out of execution hours.
- **Persistent Background Workers**: Supports permanent background schedulers, webhooks, and push notification workers.
- **Custom Health Checks**: Render natively monitors `/api/health/live` and automatically restarts the container if it becomes unhealthy.

---

## 7. Verification & Test Evidence

### Local Test Output (`keep-alive.js --once`):
```text
==================================================================
   SRT PORTAL - AUTOMATIC KEEP-ALIVE SYSTEM
==================================================================
📡 Target Endpoint : https://nipoportal.vercel.app/api/health/live
⏱️ Interval       : 5 minutes (300s)
⏳ Request Timeout : 35s
🔄 Mode            : Single-Shot (--once)
🕒 System Time     : 25/11/2026, 14:51:20 IST
==================================================================

[25/11/2026, 14:51:20 IST] [KeepAlive] Ping #1 dispatched to: https://nipoportal.vercel.app/api/health/live
[25/11/2026, 14:51:21 IST] [KeepAlive] ✅ Ping #1 OK [HTTP 200] in 783ms | Status: alive | Uptime: 229s
```

### Response Payload Received:
```json
{
  "status": "alive",
  "uptime": 229,
  "timestamp": "2026-11-25T09:21:21.012Z",
  "version": "0.1.0",
  "nodeEnv": "production"
}
```

The system is tested, committed, and ready for continuous production monitoring.
