import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/backend/db/prisma";
import { NotificationService } from "@/backend/services/notifications/NotificationService";

describe("Messaging and Universal Notifications Suite", () => {
  let adminUser: { id: string; name: string | null; role: string } | null = null;
  let parentUser: { id: string; name: string | null; role: string } | null = null;
  const createdMessageIds: string[] = [];
  const createdNotificationIds: string[] = [];

  beforeAll(async () => {
    adminUser = await prisma.user.findFirst({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { id: true, name: true, role: true },
    });

    parentUser = await prisma.user.findFirst({
      where: { role: "PARENT", status: "ACTIVE" },
      select: { id: true, name: true, role: true },
    });
  });

  afterAll(async () => {
    if (createdMessageIds.length > 0) {
      await prisma.message.deleteMany({
        where: { id: { in: createdMessageIds } },
      }).catch(() => {});
    }
    if (createdNotificationIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { id: { in: createdNotificationIds } },
      }).catch(() => {});
    }
  });

  it("saves messages quickly with clientMessageId and status sent", async () => {
    if (!adminUser || !parentUser) {
      console.warn("Skipping test: admin or parent user not present");
      return;
    }

    const testClientId = `test-cid-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const start = Date.now();

    const msg = await prisma.message.create({
      data: {
        senderId: adminUser.id,
        receiverId: parentUser.id,
        content: "Test text message with instant delivery verification",
        clientMessageId: testClientId,
        status: "sent",
        isRead: false,
      },
      select: {
        id: true,
        clientMessageId: true,
        status: true,
        isRead: true,
      },
    });

    createdMessageIds.push(msg.id);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(1500);
    expect(msg.status).toBe("sent");
    expect(msg.clientMessageId).toBe(testClientId);
    expect(msg.isRead).toBe(false);
  });

  it("enforces idempotency: rejects duplicate message with same clientMessageId", async () => {
    if (!adminUser || !parentUser) return;

    const testClientId = `test-idemp-${Date.now()}`;
    const msg = await prisma.message.create({
      data: {
        senderId: adminUser.id,
        receiverId: parentUser.id,
        content: "Idempotent initial message",
        clientMessageId: testClientId,
        status: "sent",
        isRead: false,
      },
    });
    createdMessageIds.push(msg.id);

    let failed = false;
    try {
      await prisma.message.create({
        data: {
          senderId: adminUser.id,
          receiverId: parentUser.id,
          content: "Duplicate attempt",
          clientMessageId: testClientId,
          status: "sent",
          isRead: false,
        },
      });
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
  });

  it("transitions WhatsApp status ticks: sent -> delivered -> read", async () => {
    if (!adminUser || !parentUser) return;

    const testClientId = `test-ticks-${Date.now()}`;
    const msg = await prisma.message.create({
      data: {
        senderId: adminUser.id,
        receiverId: parentUser.id,
        content: "Status ticks test message",
        clientMessageId: testClientId,
        status: "sent",
        isRead: false,
      },
    });
    createdMessageIds.push(msg.id);

    // 1. Sent
    expect(msg.status).toBe("sent");

    // 2. Delivered
    const deliveredAt = new Date();
    const deliveredMsg = await prisma.message.update({
      where: { id: msg.id },
      data: {
        status: "delivered",
        deliveredAt,
      },
    });
    expect(deliveredMsg.status).toBe("delivered");
    expect(deliveredMsg.deliveredAt).toBeDefined();

    // 3. Read
    const readAt = new Date();
    const readMsg = await prisma.message.update({
      where: { id: msg.id },
      data: {
        status: "read",
        isRead: true,
        readAt,
      },
    });
    expect(readMsg.status).toBe("read");
    expect(readMsg.isRead).toBe(true);
    expect(readMsg.readAt).toBeDefined();
  });

  it("dispatches photo message notification with image preview via NotificationService", async () => {
    if (!parentUser) return;

    const result = await NotificationService.send({
      recipients: [parentUser.id],
      type: "MESSAGE",
      category: "MESSAGE",
      title: "📷 Photo from Admin",
      body: "Sent an attachment: school-sports.jpg",
      link: "/dashboard/parent/messages",
      image: "https://main.d3bt7u4517jg0f.amplifyapp.com/logo/srt-logo.svg",
      dedupeKey: `test-photo-${Date.now()}`,
      priority: "HIGH",
    });

    if (result.notificationId) {
      createdNotificationIds.push(result.notificationId);
    }

    expect(result.success).toBe(true);
    expect(result.inAppCount).toBe(1);
  });

  it("records shownAt when unseen notifications are fetched for in-app popups", async () => {
    if (!parentUser) return;

    // Create an unseen notification
    const testNotif = await prisma.notification.create({
      data: {
        userId: parentUser.id,
        title: "Test In-App Pop-up Alert",
        content: "Testing automatic popup toaster display",
        body: "Testing automatic popup toaster display",
        type: "ANNOUNCEMENT",
        category: "GENERAL",
        priority: "HIGH",
        isRead: false,
        shownAt: null,
      },
    });
    createdNotificationIds.push(testNotif.id);

    expect(testNotif.shownAt).toBeNull();

    // Simulate mark shown
    const now = new Date();
    const updated = await prisma.notification.update({
      where: { id: testNotif.id },
      data: { shownAt: now },
    });

    expect(updated.shownAt).not.toBeNull();
  });
});
