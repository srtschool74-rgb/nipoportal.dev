import { chromium } from "@playwright/test";

const BASE_URL = process.env.AUDIT_BASE_URL || "http://127.0.0.1:3000";

async function run() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] });
  const results = [];

  try {
    // 1. Logged-out /dashboard/admin -> /login?callbackUrl=%2Fdashboard%2Fadmin
    const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p1 = await ctx1.newPage();
    await p1.goto(`${BASE_URL}/dashboard/admin`, { waitUntil: "load", timeout: 15000 });
    results.push({
      scenario: "Logged-out /dashboard/admin redirect",
      viewport: "desktop",
      finalUrl: p1.url(),
      passed: p1.url().includes("/login?callbackUrl=%2Fdashboard%2Fadmin"),
    });

    // 2. Wrong password -> visible error message, stays on /login
    await p1.fill('input:not([type="password"])', "invalid-test@example.com");
    await p1.fill('input[type="password"]', "wrong-password-123");
    await p1.click('button[type="submit"]');
    await p1.waitForSelector('[role="alert"], .error, text=/Invalid|credentials/i', { timeout: 15000 }).catch(() => null);
    const bodyText = await p1.locator("body").innerText();
    results.push({
      scenario: "Wrong password shows clear error",
      viewport: "desktop",
      finalUrl: p1.url(),
      passed: p1.url().includes("/login") && /Invalid|credentials|verify/i.test(bodyText),
    });
    await ctx1.close();

    // 3. Mobile (390x844) with SW installed + slow 4G / 5s server delay -> NO false offline page
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await ctx2.newPage();
    const t0 = Date.now();
    await p2.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 15000 });
    const coldMs = Date.now() - t0;
    await p2.waitForTimeout(1000);
    const swCount = await p2.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return 0;
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length;
    });

    const t1 = Date.now();
    await p2.reload({ waitUntil: "load", timeout: 15000 });
    const warmMs = Date.now() - t1;
    const warmText = await p2.locator("body").innerText();
    results.push({
      scenario: "Mobile warm reload with SW installed (online)",
      viewport: "mobile 390x844",
      coldMs,
      warmMs,
      swCount,
      passed: !/You are currently offline/i.test(warmText) && /Get started|Log in/i.test(warmText),
    });

    // 4. Truly offline -> offline page appears
    await ctx2.setOffline(true);
    await p2.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
    const offlineText = await p2.locator("body").innerText().catch(() => "");
    results.push({
      scenario: "Truly offline shows offline fallback",
      viewport: "mobile 390x844",
      passed: /offline|Retry Connection/i.test(offlineText),
    });

    // Restore online and verify Retry works
    await ctx2.setOffline(false);
    await p2.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 15000 });
    const backOnlineText = await p2.locator("body").innerText();
    results.push({
      scenario: "Online restored -> login page loads",
      viewport: "mobile 390x844",
      passed: /Get started|Log in/i.test(backOnlineText),
    });
    await ctx2.close();

    // 5. Home '/' -> Splash -> '/login'
    const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p3 = await ctx3.newPage();
    await p3.goto(`${BASE_URL}/`, { waitUntil: "load", timeout: 15000 });
    await p3.waitForURL("**/login", { timeout: 10000 }).catch(() => null);
    results.push({
      scenario: "Home / transitions to /login URL",
      viewport: "mobile 390x844",
      finalUrl: p3.url(),
      passed: p3.url().endsWith("/login"),
    });
    await ctx3.close();
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(results, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
