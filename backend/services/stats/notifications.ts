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

  // Single fast indexed queries (count only, no row loading or heavy groupBy hash aggregation)
  const [notificationCountRaw, busAlertCountRaw, unreadMessagesCountRaw] = await Promise.all([
    prisma.notification.count({
      where: {
        userId,
        readAt: null,
        isRead: false,
        ...clearedFilter,
      },
    }),
    prisma.notification.count({
      where: {
        userId,
        readAt: null,
        isRead: false,
        category: "BUS",
        ...clearedFilter,
      },
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

  const notificationCount = Math.max(0, notificationCountRaw);
  const busAlertCount = Math.max(0, busAlertCountRaw);
  const messageCount = Math.max(0, unreadMessagesCountRaw);
  const unreadCount = Math.max(0, notificationCount + messageCount);

  return {
    unreadCount,
    notificationCount,
    messageCount,
    busAlertCount,
    hasBusAlert: busAlertCount > 0,
  };
}
