import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/live
 * 
 * Liveness probe for Render / Docker / Orchestration.
 * Returns HTTP 200 without executing database queries or external calls.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "alive",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "0.1.0",
      nodeEnv: process.env.NODE_ENV || "production",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "X-Keep-Alive-Response": "true",
      },
    }
  );
}

export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Keep-Alive-Response": "true",
    },
  });
}
