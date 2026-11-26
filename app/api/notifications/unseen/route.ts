export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { prisma } from "@/backend/db/prisma";

export async function GET() {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) {
      return NextResponse.json({ success: true, notifications: [], totalUnseen: 0 }, { status: 200 });
    }

    const userId = session.user.id;

    // Fetch up to 10 latest unseen notifications for this user
    const unseen = await prisma.notification.findMany({
      where: {
        userId,
        shownAt: null,
        isRead: false,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        content: true,
        body: true,
        type: true,
        category: true,
        priority: true,
        link: true,
        data: true,
        createdAt: true,
      },
    });

    const totalUnseen = await prisma.notification.count({
      where: {
        userId,
        shownAt: null,
        isRead: false,
      },
    });

    // Mark fetched notifications as shown so they never pop up again
    if (unseen.length > 0) {
      const now = new Date();
      await prisma.notification.updateMany({
        where: {
          id: { in: unseen.map((n) => n.id) },
        },
        data: {
          shownAt: now,
        },
      }).catch((err) => console.warn("[Notifications/Unseen] Mark shown note:", err));
    }

    const mapped = unseen.map((n) => {
      let image: string | undefined = undefined;
      if (n.data && typeof n.data === "object" && (n.data as any).image) {
        image = (n.data as any).image;
      }
      return {
        id: n.id,
        title: n.title,
        body: n.body || n.content,
        type: n.type,
        category: n.category || n.type,
        priority: n.priority || "NORMAL",
        link: n.link || "/dashboard",
        image,
        createdAt: n.createdAt,
      };
    });

    return NextResponse.json(
      {
        success: true,
        notifications: mapped,
        totalUnseen,
      },
      {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (error) {
    const e = error as Error;
    console.error("GET /api/notifications/unseen error:", e);
    return NextResponse.json({ error: e.message || "Failed to fetch unseen notifications" }, { status: 500 });
  }
}
