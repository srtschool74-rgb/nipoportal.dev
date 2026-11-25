import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/ping
 * 
 * Ultra-lightweight keep-alive ping endpoint for Render / Vercel.
 * Deliberately performs ZERO database queries, ZERO auth checks, and ZERO disk I/O
 * to prevent database connection pool exhaustion and maximize response speed (<5ms).
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      ping: "pong",
      service: "srt-portal",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
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
