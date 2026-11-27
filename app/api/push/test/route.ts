import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { prisma } from "@/backend/db/prisma";
import webpush from "web-push";
import { sendOneSignalPush, ONESIGNAL_APP_ID } from "@/backend/services/push/oneSignalService";

export const dynamic = "force-dynamic";

// Short-lived in-memory idempotency cache (prevents double-send on rapid double click / retry)
const recentTestPushKeys = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 30_000;

function checkAndRecordIdempotency(userId: string, key?: string): boolean {
  if (!key) return true;
  const now = Date.now();
  for (const [k, exp] of recentTestPushKeys.entries()) {
    if (now > exp) recentTestPushKeys.delete(k);
  }
  const composite = `${userId}:${key}`;
  const existing = recentTestPushKeys.get(composite);
  if (existing && now < existing) {
    return false;
  }
  recentTestPushKeys.set(composite, now + IDEMPOTENCY_TTL_MS);
  return true;
}

// Ensure VAPID keys are initialized as auxiliary fallback
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BBIHzbc-DVhlpPB_plCE0gUMpCSsHiqA1Y5FVyP-ax6p0HWnFZILFISth4FYfyAp0gywswCBxz4GfDnXm_c-Agk";

const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  "ExZi6lTrD-JWJN9cqk88AA6Y8-vxTYaxwhaY4AUwMFc";

const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:admin@nipoportal.com";

try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  console.warn("[Push Test API] VAPID initialization warning:", err);
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: "Unauthorized. Please log in first." }, { status: 401 });
    }

    const userId = session.user.id;
    const userRole = String(session.user.role || "").toUpperCase();
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Forbidden. Admin role required." }, { status: 403 });
    }
    const userName = session.user.name || "User";

    const bodyPayload = await req.json().catch(() => ({}));
    const idempotencyKey = typeof bodyPayload.idempotencyKey === "string" ? bodyPayload.idempotencyKey.trim() : "";

    if (idempotencyKey && !checkAndRecordIdempotency(userId, idempotencyKey)) {
      return NextResponse.json({
        success: true,
        deduplicated: true,
        userId,
        message: "Duplicate test push request ignored (idempotent).",
      });
    }

    // 1. Calculate recipient's exact unread notification count from PostgreSQL
    let unreadCount = 1;
    try {
      const [unreadNotifs, unreadMsgs] = await Promise.all([
        prisma.notification.count({ where: { userId, isRead: false } }),
        prisma.message.count({ where: { receiverId: userId, isRead: false } }),
      ]);
      unreadCount = Math.max(1, unreadNotifs + unreadMsgs);
    } catch {
      unreadCount = 1;
    }

    const title = bodyPayload.title || "🔔 Portal Push Test";
    const body =
      bodyPayload.body ||
      bodyPayload.message ||
      "OneSignal Web Push & direct WebPush are operational on SRT Portal!";
    const url = bodyPayload.url || "/dashboard";
    const stableTag = idempotencyKey ? `test-${userId}-${idempotencyKey}` : `test-${userId}`;

    // 2. Primary Channel: Send strictly to calling admin's external_id (NEVER broadcast)
    const oneSignalResult = await sendOneSignalPush({
      userId,
      broadcast: false,
      title,
      body,
      url,
      unreadCount,
      category: "TEST",
      tag: stableTag,
    });

    const oneSignalDelivered = oneSignalResult.success && (oneSignalResult.recipients ?? 0) > 0;

    // 3. Fallback Channel ONLY if OneSignal did not deliver to any device for this admin
    const targetMap = new Map<string, { endpoint: string; p256dh: string; auth: string; source: string; platform: string }>();
    if (!oneSignalDelivered) {
      const [pushSubs, pwaSubs, registrySubs] = await Promise.all([
        prisma.pushSubscription.findMany({
          where: { userId, isActive: true },
          select: { id: true, endpoint: true, p256dh: true, auth: true, platform: true, deviceName: true },
        }),
        prisma.pwaSubscription.findMany({
          where: { userId },
          select: { id: true, endpoint: true, p256dhKey: true, authKey: true, deviceType: true },
        }).catch(() => []),
        prisma.deviceNotificationsRegistry.findMany({
          where: { userId },
          select: { id: true, endpoint: true, p256dh: true, auth: true, deviceId: true },
        }).catch(() => []),
      ]);

      for (const sub of pushSubs) {
        if (sub.endpoint && sub.p256dh && sub.auth) {
          targetMap.set(sub.endpoint, {
            endpoint: sub.endpoint,
            p256dh: sub.p256dh,
            auth: sub.auth,
            source: "pushSubscription",
            platform: sub.platform || "WEB",
          });
        }
      }

      for (const sub of pwaSubs) {
        if (sub.endpoint && sub.p256dhKey && sub.authKey && !targetMap.has(sub.endpoint)) {
          targetMap.set(sub.endpoint, {
            endpoint: sub.endpoint,
            p256dh: sub.p256dhKey,
            auth: sub.authKey,
            source: "pwaSubscription",
            platform: sub.deviceType?.toUpperCase() === "IOS" ? "IOS" : "WEB",
          });
        }
      }

      for (const sub of registrySubs) {
        if (sub.endpoint && sub.p256dh && sub.auth && !targetMap.has(sub.endpoint)) {
          targetMap.set(sub.endpoint, {
            endpoint: sub.endpoint,
            p256dh: sub.p256dh,
            auth: sub.auth,
            source: "deviceRegistry",
            platform: "WEB",
          });
        }
      }
    }

    const uniqueTargets = Array.from(targetMap.values());
    let webPushDelivered = 0;
    let webPushFailed = 0;
    const deviceResults: Array<{ endpoint: string; status: "DELIVERED" | "FAILED"; statusCode?: number; error?: string }> = [];

    if (uniqueTargets.length > 0) {
      const payload = JSON.stringify({
        title,
        body,
        url,
        unreadCount,
        badgeCount: unreadCount,
        icon: "/icon-192x192.png",
        badge: "/badge-72x72.png",
        vibrate: [200, 100, 200],
        requireInteraction: true,
        renotify: true,
        tag: stableTag,
        data: {
          url,
          unreadCount,
          timestamp: Date.now(),
        },
      });

      const webOptions = {
        TTL: 60,
        urgency: "high" as const,
        headers: {
          Urgency: "high",
        },
      };

      await Promise.allSettled(
        uniqueTargets.map(async (target) => {
          try {
            const res = await webpush.sendNotification(
              {
                endpoint: target.endpoint,
                keys: {
                  p256dh: target.p256dh,
                  auth: target.auth,
                },
              },
              payload,
              webOptions
            );

            webPushDelivered++;
            deviceResults.push({
              endpoint: target.endpoint.slice(0, 45) + "...",
              status: "DELIVERED",
              statusCode: res.statusCode || 201,
            });
          } catch (pushErr: any) {
            webPushFailed++;
            const statusCode = pushErr?.statusCode || 500;
            const errorMsg = pushErr?.message || pushErr?.body || "Failed to deliver push";

            deviceResults.push({
              endpoint: target.endpoint.slice(0, 45) + "...",
              status: "FAILED",
              statusCode,
              error: errorMsg,
            });

            if (statusCode === 404 || statusCode === 410) {
              await prisma.pushSubscription
                .updateMany({
                  where: { endpoint: target.endpoint },
                  data: { isActive: false },
                })
                .catch(() => {});
            }
          }
        })
      );
    }

    const deliveredCount = oneSignalDelivered
      ? oneSignalResult.recipients || 0
      : webPushDelivered;
    const providerUsed = oneSignalDelivered
      ? "ONESIGNAL"
      : uniqueTargets.length > 0
      ? "WEBPUSH"
      : "NONE";
    const overallSuccess = deliveredCount >= 1;

    let code: string | undefined;
    let errorMessage: string | undefined;
    let httpStatus = 200;

    if (!overallSuccess) {
      if (uniqueTargets.length === 0 && (!oneSignalResult.error || oneSignalResult.error.includes("RECIPIENTS_ZERO"))) {
        code = "NO_ACTIVE_SUBSCRIPTION";
        errorMessage = "No active device registered for this account. Enable notifications on this device.";
        httpStatus = 200;
      } else {
        code = "PROVIDER_ERROR";
        errorMessage =
          oneSignalResult.error ||
          deviceResults.find((r) => r.status === "FAILED")?.error ||
          "Push provider failed to deliver to any active device.";
        httpStatus = 502;
      }
    }

    console.log("[/api/push/test]", {
      userId,
      provider: providerUsed,
      recipients: oneSignalDelivered ? oneSignalResult.recipients : uniqueTargets.length,
      delivered: deliveredCount,
      failed: webPushFailed,
      code: code || "OK",
    });

    await prisma.notificationDelivery
      .create({
        data: {
          eventType: "TEST_PUSH",
          recipientUserId: userId,
          channel: providerUsed,
          status: overallSuccess ? "DELIVERED" : code || "FAILED",
          onesignalNotificationId: oneSignalResult.notificationId || null,
          httpStatus,
          recipientsCount: deliveredCount,
          errorCode: code || null,
          errorMessage: errorMessage || null,
          tag: stableTag,
          sentAt: overallSuccess ? new Date() : null,
        },
      })
      .catch(() => {});

    return NextResponse.json(
      {
        success: overallSuccess,
        delivered: deliveredCount,
        recipients: oneSignalDelivered ? oneSignalResult.recipients || 0 : uniqueTargets.length,
        provider: providerUsed,
        ...(code ? { code } : {}),
        ...(errorMessage ? { error: errorMessage } : {}),
        userId,
        userName,
        unreadCount,
        oneSignal: {
          appId: ONESIGNAL_APP_ID,
          externalId: userId,
          result: oneSignalResult,
        },
        webPush: {
          subscriptionsFound: uniqueTargets.length,
          delivered: webPushDelivered,
          failed: webPushFailed,
          deviceResults,
        },
        message: overallSuccess
          ? "Push notification dispatched successfully."
          : errorMessage || "Could not send test notification.",
      },
      { status: httpStatus }
    );
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Internal server error";
    console.error("[Push Test API] Error:", error);
    return NextResponse.json({ success: false, error: errMessage }, { status: 500 });
  }
}

export async function GET() {
  return POST(new Request("https://localhost/api/push/test", { method: "POST" }));
}
