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

    // Timeout guard to prevent serverless function hangs under pool contention
    const fetchWork = async () => {
      // Fetch up to 10 latest unseen notifications for this user (indexed query)
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

      // Mark fetched notifications as shown in background without blocking response
      if (unseen.length > 0) {
        const now = new Date();
        prisma.notification
          .updateMany({
            where: {
              id: { in: unseen.map((n) => n.id) },
            },
            data: {
              shownAt: now,
            },
          })
          .catch((err) => console.warn("[Notifications/Unseen] Mark shown note:", err));
      }

      return { unseen, totalUnseen };
    };

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Query timed out after 4500ms")), 4500)
    );

    const { unseen, totalUnseen } = await Promise.race([fetchWork(), timeoutPromise]);

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
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[API /api/notifications/unseen] Error:", errMsg);
    return NextResponse.json(
      { success: false, error: "Failed to fetch unseen notifications", message: errMsg },
      { status: errMsg.includes("timed out") ? 504 : 500 }
    );
  }
}
