import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { getAdminDashboardSummary } from "@/backend/services/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Protect against serverless 5s freeze by enforcing a 4.5s timeout race
    const summaryPromise = getAdminDashboardSummary({
      role: session.user.role,
      userId: session.user.id,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Database summary query timed out after 4500ms")), 4500)
    );

    const summary = await Promise.race([summaryPromise, timeoutPromise]);

    return NextResponse.json(
      { success: true, summary, updatedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
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
