export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import crypto from "crypto";
import { prisma } from "@/backend/db/prisma";
import { deleteS3Object, isS3Configured } from "@/backend/lib/storage/s3Storage";

function safeCompare(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const cronSecret = process.env.CRON_SECRET;

  let authorized = Boolean(cronSecret && safeCompare(authHeader, cronSecret));
  if (!authorized) {
    try {
      const session = await getServerSession(getAuthOptions());
      if (session?.user?.role === "ADMIN") {
        authorized = true;
      }
    } catch {}
  }

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    const orphans = await prisma.attachment.findMany({
      where: {
        status: "PENDING",
        createdAt: { lt: cutoff },
      },
      select: { id: true, storageKey: true },
      take: 100,
    });

    let s3DeletedCount = 0;
    if (isS3Configured()) {
      for (const orphan of orphans) {
        if (orphan.storageKey) {
          const ok = await deleteS3Object(orphan.storageKey);
          if (ok) s3DeletedCount++;
        }
      }
    }

    const deleteRes = await prisma.attachment.deleteMany({
      where: {
        id: { in: orphans.map((o) => o.id) },
      },
    });

    return NextResponse.json({
      ok: true,
      orphansFound: orphans.length,
      deletedFromDb: deleteRes.count,
      s3DeletedCount,
    });
  } catch (error: any) {
    console.error("[CleanupAttachments] Error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
