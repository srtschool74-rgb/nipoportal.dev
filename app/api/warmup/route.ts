import { NextResponse } from "next/server";
import { prisma } from "@/backend/db/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/warmup
 * 
 * Pre-warms the serverless lambda runtime and database connection pooler.
 * Called in the background by GlobalPrefetcher so that subsequent user requests
 * and dashboard loads experience 0ms connection setup latency.
 */
export async function GET() {
  const start = Date.now();
  try {
    // Ultra-lightweight connection test to keep the Prisma / Neon PgBouncer connection warm
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "warm",
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "fallback",
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : "Warmup error",
      },
      { status: 200 } // Return 200 so prefetch never throws an unhandled error
    );
  }
}
