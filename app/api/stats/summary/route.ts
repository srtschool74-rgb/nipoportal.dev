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

    const summary = await getAdminDashboardSummary({
      role: session.user.role,
      userId: session.user.id,
    });

    return NextResponse.json(
      { success: true, summary, updatedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (err) {
    console.error("GET /api/stats/summary error:", err);
    return NextResponse.json({ error: "Failed to load stats summary" }, { status: 500 });
  }
}
