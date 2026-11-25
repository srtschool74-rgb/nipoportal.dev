import "server-only";
import { invalidateCalendarStatsCache } from "@/backend/api/actions/dashboard/attendance/calendarStats";
import { invalidateUserNotifCache } from "@/backend/api/actions/notifications/unifiedNotificationActions";
import { invalidateParentRecordCache } from "@/backend/services/parent/parentChildHelper";
import { invalidateTeacherCache } from "@/backend/services/teacher/teacherHelper";

interface StatsCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;
const statsMemoryCache = new Map<string, StatsCacheEntry<unknown>>();
let statsVersion = 1;

/**
 * Reads a short-lived stats entry scoped cleanly by key and current statsVersion.
 * Never used to cache unkeyed per-user private records.
 */
export async function withShortStatsCache<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  if (ttlMs <= 0) {
    return loader();
  }

  const versionedKey = `v${statsVersion}:${key}`;
  const now = Date.now();
  const hit = statsMemoryCache.get(versionedKey);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }

  const value = await loader();
  if (statsMemoryCache.size > 500) {
    statsMemoryCache.clear();
  }
  statsMemoryCache.set(versionedKey, { value, expiresAt: now + ttlMs });
  return value;
}

export function clearStatsCache(): void {
  statsVersion += 1;
  statsMemoryCache.clear();
}

const DASHBOARD_PATHS_TO_REVALIDATE = [
  "/dashboard/admin",
  "/dashboard/admin/students",
  "/dashboard/admin/teachers",
  "/dashboard/admin/parents",
  "/dashboard/admin/classes",
  "/dashboard/admin/classes/reconciliation",
  "/dashboard/admin/data-check",
  "/dashboard/admin/subjects",
  "/dashboard/admin/users",
  "/dashboard/admin/attendance",
  "/dashboard/admin/teacher-attendance",
  "/dashboard/admin/staff-attendance",
  "/dashboard/admin/exams",
  "/dashboard/admin/performance",
  "/dashboard/admin/report-cards",
  "/dashboard/admin/transport",
  "/admin/buses",
  "/dashboard/admin/messages",
  "/dashboard/admin/notifications",
  "/dashboard/teacher",
  "/dashboard/teacher/classes",
  "/dashboard/teacher/attendance",
  "/dashboard/teacher/exams",
  "/dashboard/teacher/report-cards",
  "/dashboard/parent",
  "/dashboard/parent/classes",
  "/dashboard/parent/attendance",
  "/dashboard/parent/exams",
  "/dashboard/parent/report-cards",
  "/parent/bus",
] as const;

/**
 * Must be called after every create, update, delete, status change, import,
 * promotion, attendance save, marks change, or read-state change.
 * Safe to invoke inside CLI tests outside Next.js request scope.
 */
export async function invalidateAllStatsCaches(options?: {
  userId?: string;
  extraPaths?: string[];
}): Promise<void> {
  clearStatsCache();

  try {
    invalidateParentRecordCache(options?.userId);
  } catch {}
  try {
    invalidateTeacherCache(options?.userId);
  } catch {}
  try {
    invalidateCalendarStatsCache();
  } catch {}
  try {
    await invalidateUserNotifCache(options?.userId);
  } catch {}

  try {
    const { revalidatePath } = await import("next/cache");
    const paths = options?.extraPaths
      ? [...DASHBOARD_PATHS_TO_REVALIDATE, ...options.extraPaths]
      : DASHBOARD_PATHS_TO_REVALIDATE;
    for (const p of paths) {
      try {
        revalidatePath(p);
      } catch {}
    }
  } catch {}
}
