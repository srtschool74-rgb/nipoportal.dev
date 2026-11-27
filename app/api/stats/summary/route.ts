import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { getAdminDashboardSummary } from "@/backend/services/stats";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const preferredRegion = "hnd1";

export async function GET() {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Protect against serverless freeze while allowing cross-region cold-start headroom
    const summaryPromise = getAdminDashboardSummary({
      role: session.user.role,
      userId: session.user.id,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Database summary query timed out after 25000ms")), 25000)
    );

    const summary = await Promise.race([summaryPromise, timeoutPromise]);

    return NextResponse.json(
      { success: true, summary, updatedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
        },
      }
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API /api/stats/summary] Error:", errMsg);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load stats summary",
        message: errMsg,
      },
      { status: errMsg.includes("timed out") ? 504 : 500 }
    );
  }
}
