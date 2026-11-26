#!/usr/bin/env node
/**
 * ==============================================================================
 * SRT UNIVERSAL SCHOOL MANAGEMENT PORTAL
 * Production Keep-Alive & Health Ping Daemon
 * ==============================================================================
 * 
 * Objective:
 *   Keeps the Render web service backend continuously awake by sending periodic
 *   lightweight HTTP GET requests to the zero-database liveness endpoint (/api/health/live).
 * 
 * Key Features:
 *   - Zero external npm dependencies (uses native Node.js fetch & AbortController).
 *   - Configurable interval: default 5 minutes, clamped between 5 and 10 minutes.
 *   - Dual execution modes:
 *       1) Continuous Daemon Mode: runs in a background loop with interval timer & jitter.
 *       2) Single-Shot Mode (--once / --cron): runs 1 ping, logs diagnostics, exits cleanly.
 *   - Concurrency lock: prevents overlapping / duplicate requests during cold starts.
 *   - Resilient retry & timeout handling (handles Render cold start spin-ups up to 45s).
 *   - Zero database load: targets /api/health/live (which executes 0 SQL queries).
 * 
 * Usage:
 *   node keep-alive.js                       # Starts continuous daemon (default 5m interval)
 *   node keep-alive.js --once                # Runs a single ping and exits (for GitHub Actions)
 *   node keep-alive.js --interval=7          # Sets interval to 7 minutes (clamped 5-10m)
 *   TARGET_URL=https://my-backend.com node keep-alive.js
 * 
 * ==============================================================================
 */

const path = require("path");

// Load local environment files if present (Node.js 20.12+ or fallback)
try {
  if (typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile(path.resolve(__dirname, ".env.local")); } catch {}
    try { process.loadEnvFile(path.resolve(__dirname, ".env")); } catch {}
  }
} catch {}

// ------------------------------------------------------------------------------
// Configuration & Defaults
// ------------------------------------------------------------------------------
const DEFAULT_URL =
  process.env.RENDER_URL ||
  process.env.BACKEND_URL ||
  process.env.RENDER_BACKEND_URL ||
  process.env.TARGET_URL ||
  "https://nipoportal-dev.onrender.com";

const DEFAULT_PATH = "/api/health/live";
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 10;
const DEFAULT_INTERVAL_MINUTES = 5;
const REQUEST_TIMEOUT_MS = parseInt(process.env.PING_TIMEOUT_MS || "35000", 10); // 35s to allow Render cold start
const MAX_RETRIES = parseInt(process.env.PING_RETRIES || "2", 10);

// Parse CLI flags
const args = process.argv.slice(2);
const isSingleShot = args.includes("--once") || args.includes("-1") || args.includes("--cron");
const isSilent = args.includes("--silent") || args.includes("-s");

// Parse custom interval if provided (--interval=X or env)
let configuredMinutes = DEFAULT_INTERVAL_MINUTES;
const intervalArg = args.find((a) => a.startsWith("--interval="));
if (intervalArg) {
  const parsed = parseFloat(intervalArg.split("=")[1]);
  if (!isNaN(parsed)) configuredMinutes = parsed;
} else if (process.env.INTERVAL_MINUTES || process.env.PING_INTERVAL_MINUTES) {
  const parsed = parseFloat(process.env.INTERVAL_MINUTES || process.env.PING_INTERVAL_MINUTES);
  if (!isNaN(parsed)) configuredMinutes = parsed;
}

// Clamp interval between 5 and 10 minutes per specification
const intervalMinutes = Math.min(
  Math.max(configuredMinutes, MIN_INTERVAL_MINUTES),
  MAX_INTERVAL_MINUTES
);
const intervalMs = Math.round(intervalMinutes * 60 * 1000);

// Resolve final Target URL
let rawTarget = args.find((a) => a.startsWith("http://") || a.startsWith("https://")) || DEFAULT_URL;
if (!rawTarget.endsWith(DEFAULT_PATH) && !rawTarget.includes("/api/")) {
  rawTarget = rawTarget.replace(/\/+$/, "") + DEFAULT_PATH;
}
const targetUrl = rawTarget;

// Concurrency mutex lock to prevent duplicate overlapping pings
let isPingInProgress = false;
let pingCounter = 0;
let successCounter = 0;
let failureCounter = 0;

// Format timestamps
function getTimestamp() {
  const now = new Date();
  return {
    iso: now.toISOString(),
    ist: now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) + " IST",
  };
}

// Logger helper
function log(msg, type = "info") {
  if (isSilent && type === "info") return;
  const time = getTimestamp().ist;
  const prefix = `[${time}] [KeepAlive]`;
  if (type === "success") {
    console.log(`\x1b[32m${prefix} ✅ ${msg}\x1b[0m`);
  } else if (type === "warn") {
    console.warn(`\x1b[33m${prefix} ⚠️ ${msg}\x1b[0m`);
  } else if (type === "error") {
    console.error(`\x1b[31m${prefix} ❌ ${msg}\x1b[0m`);
  } else {
    console.log(`\x1b[36m${prefix}\x1b[0m ${msg}`);
  }
}

/**
 * Execute a single HTTP GET keep-alive ping with timeout and retry logic.
 * Returns an object with ping metrics and success status.
 */
async function executePing(url, attempt = 1) {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "SRT-Portal-KeepAlive/1.0 (+https://nipoportal.vercel.app)",
        "Accept": "application/json, text/plain, */*",
        "Cache-Control": "no-cache",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    let data = null;

    try {
      data = await res.json();
    } catch {
      data = await res.text().catch(() => "");
    }

    if (res.ok) {
      return {
        success: true,
        status: res.status,
        statusText: res.statusText,
        latencyMs,
        data,
      };
    } else {
      // Non-200 HTTP response
      const err = new Error(`HTTP ${res.status} ${res.statusText}`);
      err.status = res.status;
      err.latencyMs = latencyMs;
      err.data = data;
      throw err;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (err.name === "AbortError") {
      const timeoutErr = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms (Render server may be cold starting)`);
      timeoutErr.isTimeout = true;
      timeoutErr.latencyMs = latencyMs;
      throw timeoutErr;
    }

    err.latencyMs = latencyMs;
    throw err;
  }
}

/**
 * High-level ping orchestrator with concurrency guard and retry
 */
async function runPingCycle() {
  if (isPingInProgress) {
    log("A ping is already in flight. Skipping cycle to prevent duplicate execution.", "warn");
    return { skipped: true };
  }

  isPingInProgress = true;
  pingCounter++;
  const cycleNumber = pingCounter;

  log(`Ping #${cycleNumber} dispatched to: ${targetUrl}`);

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const result = await executePing(targetUrl, attempt);
      successCounter++;
      isPingInProgress = false;

      log(
        `Ping #${cycleNumber} OK [HTTP ${result.status}] in ${result.latencyMs}ms | Status: ${
          result.data?.status || "online"
        } | Uptime: ${result.data?.uptime !== undefined ? result.data.uptime + "s" : "N/A"}`,
        "success"
      );

      return { success: true, ...result };
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt > MAX_RETRIES;
      const retryMsg = isLastAttempt ? "All retries exhausted." : `Retrying in 4s (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`;

      log(
        `Ping #${cycleNumber} Attempt ${attempt} failed (${err.message}) in ${err.latencyMs || 0}ms. ${retryMsg}`,
        isLastAttempt ? "error" : "warn"
      );

      if (!isLastAttempt) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    }
  }

  failureCounter++;
  isPingInProgress = false;
  return {
    success: false,
    error: lastError?.message || "Unknown ping failure",
    latencyMs: lastError?.latencyMs || 0,
  };
}

// ------------------------------------------------------------------------------
// Execution Logic
// ------------------------------------------------------------------------------
async function main() {
  console.log("==================================================================");
  console.log("   SRT PORTAL - AUTOMATIC KEEP-ALIVE SYSTEM");
  console.log("==================================================================");
  console.log(`📡 Target Endpoint : ${targetUrl}`);
  console.log(`⏱️ Interval       : ${intervalMinutes} minutes (${intervalMs / 1000}s)`);
  console.log(`⏳ Request Timeout : ${REQUEST_TIMEOUT_MS / 1000}s`);
  console.log(`🔄 Mode            : ${isSingleShot ? "Single-Shot (--once)" : "Continuous Daemon"}`);
  console.log(`🕒 System Time     : ${getTimestamp().ist}`);
  console.log("==================================================================\n");

  if (isSingleShot) {
    // Single-shot mode for GitHub Actions or external crons
    const res = await runPingCycle();
    if (!res.success && !res.skipped) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
    return;
  }

  // Continuous Daemon Mode
  // Run first ping immediately
  await runPingCycle();

  // Schedule subsequent runs with interval timer
  const timer = setInterval(async () => {
    // Add 0-3s jitter to avoid synchronized traffic spikes
    const jitter = Math.floor(Math.random() * 3000);
    setTimeout(async () => {
      await runPingCycle();
      log(`Next scheduled ping in ~${intervalMinutes} minutes (Successes: ${successCounter}, Failures: ${failureCounter})`);
    }, jitter);
  }, intervalMs);

  // Graceful shutdown handling
  const shutdown = (signal) => {
    console.log(`\n[KeepAlive] Received ${signal}. Shutting down cleanly...`);
    clearInterval(timer);
    console.log(`[KeepAlive] Total Pings: ${pingCounter} | Successful: ${successCounter} | Failed: ${failureCounter}`);
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Export for programmatic module import or run as CLI
if (require.main === module) {
  main().catch((fatal) => {
    console.error("[KeepAlive] Fatal process error:", fatal);
    process.exit(1);
  });
} else {
  module.exports = {
    executePing,
    runPingCycle,
    targetUrl,
    intervalMinutes,
  };
}
