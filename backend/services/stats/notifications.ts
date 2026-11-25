import "server-only";
import { prisma } from "@/backend/db/prisma";
import { NotificationUnreadStats } from "./types";

/**
 * Canonical unread notification & message counts strictly for one user.
 * Rules:
 * - Unread notification: Notification.userId = userId AND readAt = null AND isRead = false
 * - Unread message: Message.receiverId = userId AND isRead = false AND isDeleted = false
 * - Never returns negative numbers.
 */
export async function getUnreadNotificationStats(
  userId: string,
  options?: { clearedAfter?: Date | null }
): Promise<NotificationUnreadStats> {
  if (!userId) {
    return {
      unreadCount: 0,
      notificationCount: 0,
      messageCount: 0,
      busAlertCount: 0,
      hasBusAlert: false,
    };
  }

  const clearedFilter =
    options?.clearedAfter && !isNaN(options.clearedAfter.getTime())
      ? { createdAt: { gt: options.clearedAfter } }
      : {};

  const [notifCounts, unreadMessagesCount] = await Promise.all([
    prisma.notification.groupBy({
      by: ["category"],
      where: {
        userId,
        readAt: null,
        isRead: false,
        ...clearedFilter,
      },
      _count: { _all: true },
    }),
    prisma.message.count({
      where: {
        receiverId: userId,
        isRead: false,
        isDeleted: false,
        ...clearedFilter,
      },
    }),
  ]);

  let notificationCount = 0;
  let busAlertCount = 0;

  for (const row of notifCounts) {
    const c = Math.max(0, row._count._all);
    notificationCount += c;
    if (row.category === "BUS") {
      busAlertCount += c;
    }
  }

  const messageCount = Math.max(0, unreadMessagesCount);
  const unreadCount = Math.max(0, notificationCount + messageCount);

  return {
    unreadCount,
    notificationCount,
    messageCount,
    busAlertCount,
    hasBusAlert: busAlertCount > 0,
  };
}
