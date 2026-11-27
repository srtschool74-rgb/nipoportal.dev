import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getUnreadNotificationStats } from "@/backend/services/stats";
import { ServerTimer } from "@/lib/perf/serverTimer";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const timer = new ServerTimer("/api/notifications/unread-count", "GET");

  try {
    const token = await timer.measure("auth", () =>
      getToken({
        req,
        secret: process.env.NEXTAUTH_SECRET || process.env.SUPABASE_JWT_SECRET,
      })
    );

    if (!token?.id || token.isRevoked) {
      timer.logSummary(401);
      return NextResponse.json(
        { unreadCount: 0, hasBusAlert: false, messageCount: 0, notificationCount: 0, busAlertCount: 0 },
        {
          status: 401,
          headers: { "Server-Timing": timer.getHeaderValue() },
        }
      );
    }

    const userId = token.id as string;
    // Prefer header 'x-cleared-time' so URL remains clean and static for deduplication
    const clearedTimeParam =
      req.headers.get("x-cleared-time") || req.nextUrl.searchParams.get("clearedTime");
    const parsedCleared = clearedTimeParam ? new Date(clearedTimeParam) : null;
    const clearedAfter = parsedCleared && !isNaN(parsedCleared.getTime()) ? parsedCleared : null;

    const stats = await timer.measure("db-unread-stats", () =>
      getUnreadNotificationStats(userId, { clearedAfter })
    );

    timer.logSummary(200, token.role as string);

    return NextResponse.json(
      {
        success: true,
        ...stats,
      },
      {
        headers: {
          "Server-Timing": timer.getHeaderValue(),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    console.error("GET /api/notifications/unread-count error:", error);
    timer.logSummary(500);
    return NextResponse.json(
      { success: false, unreadCount: 0, hasBusAlert: false, messageCount: 0, notificationCount: 0, busAlertCount: 0 },
      {
        status: 500,
        headers: { "Server-Timing": timer.getHeaderValue() },
      }
    );
  }
}
