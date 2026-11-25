import { prisma } from "@/backend/db/prisma";
import { getSchoolNow, coerceToDate } from "@/lib/time";
import {
  countSchoolWorkingDays,
  getEffectiveAcademicYearRange,
  parseDateString,
  toDateString,
} from "@/backend/lib/services/attendanceCalculation";
import { roundOneDecimal } from "./academics";
import { AttendanceStatsResult } from "./types";

/**
 * Resolves the academic year boundaries (June 1 -> May 31) strictly in Asia/Kolkata timezone.
 */
export function getSchoolAcademicYearRange(refDate?: Date | string): { start: Date; end: Date } {
  const parts = getSchoolNow(refDate);
  // Academic cycle runs June (month 6) through May (month 5)
  const startYear = parts.month >= 6 ? parts.year : parts.year - 1;
  const start = parseDateString(`${startYear}-06-01`);
  const end = new Date(Date.UTC(startYear + 1, 4, 31, 23, 59, 59, 999));
  return { start, end };
}

/**
 * Resolves calendar month boundaries [YYYY-MM-01, last day] in Asia/Kolkata.
 */
export function getSchoolMonthRange(refDate?: Date | string): { start: Date; end: Date } {
  const parts = getSchoolNow(refDate);
  const startStr = `${parts.year}-${String(parts.month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  const start = parseDateString(startStr);
  const end = new Date(Date.UTC(parts.year, parts.month - 1, lastDay, 23, 59, 59, 999));
  return { start, end };
}

/**
 * Canonical Attendance Percentage helper:
 * - Counts Present + Late as attended sessions.
 * - Never divides by zero.
 * - Rounds strictly to 1 decimal place (toFixed(1)), clamped [0.0, 100.0].
 * - Returns "0.0" (hasWorkingSessions = false) when totalWorkingUnits <= 0 instead of falsely claiming 100%.
 */
export function computeAttendanceMetrics(params: {
  presentCount: number;
  absentCount: number;
  lateCount: number;
  leaveCount: number;
  officialWorkingDays: number;
}): AttendanceStatsResult {
  const presentCount = Math.max(0, Number(params.presentCount) || 0);
  const absentCount = Math.max(0, Number(params.absentCount) || 0);
  const lateCount = Math.max(0, Number(params.lateCount) || 0);
  const leaveCount = Math.max(0, Number(params.leaveCount) || 0);
  const officialWorkingDays = Math.max(0, Number(params.officialWorkingDays) || 0);

  const officialWorkingSessions = officialWorkingDays * 2;
  const recordedSessions = presentCount + absentCount + lateCount + leaveCount;
  const attendedSessions = presentCount + lateCount;
  const totalWorkingSessions = Math.max(officialWorkingSessions, recordedSessions, attendedSessions);

  if (totalWorkingSessions <= 0) {
    return {
      officialWorkingDays,
      officialWorkingSessions,
      presentCount,
      absentCount,
      lateCount,
      leaveCount,
      recordedSessions,
      attendedSessions,
      totalWorkingSessions: 0,
      percentage: "0.0",
      percentageValue: null,
      hasWorkingSessions: false,
    };
  }

  const rawPct = (attendedSessions / totalWorkingSessions) * 100;
  const clamped = Math.min(100, Math.max(0, roundOneDecimal(rawPct)));

  return {
    officialWorkingDays,
    officialWorkingSessions,
    presentCount,
    absentCount,
    lateCount,
    leaveCount,
    recordedSessions,
    attendedSessions,
    totalWorkingSessions,
    percentage: clamped.toFixed(1),
    percentageValue: clamped,
    hasWorkingSessions: true,
  };
}

/**
 * Summarizes raw Attendance rows against working days (used for students, classes, teachers, staff).
 */
export function summarizeAttendanceRecords(
  records: Array<{ status: string }>,
  officialWorkingDays: number
): AttendanceStatsResult {
  let presentCount = 0;
  let absentCount = 0;
  let lateCount = 0;
  let leaveCount = 0;

  for (const r of records) {
    const st = (r.status || "").toUpperCase();
    if (st === "PRESENT") presentCount++;
    else if (st === "ABSENT") absentCount++;
    else if (st === "LATE") lateCount++;
    else if (st === "LEAVE") leaveCount++;
  }

  return computeAttendanceMetrics({
    presentCount,
    absentCount,
    lateCount,
    leaveCount,
    officialWorkingDays,
  });
}

/**
 * Single source of truth DB query for a student's attendance summary (academic year or month).
 */
export async function getStudentAttendanceSummary(
  studentId: string,
  options?: {
    classId?: string | null;
    range?: "ACADEMIC_YEAR" | "MONTH" | { start: Date; end: Date };
    referenceDate?: Date;
  }
): Promise<AttendanceStatsResult> {
  const ref = coerceToDate(options?.referenceDate);
  let start: Date;
  let end: Date;

  if (options?.range === "MONTH") {
    const monthRange = getSchoolMonthRange(ref);
    start = monthRange.start;
    end = ref < monthRange.end ? ref : monthRange.end;
  } else if (options?.range && typeof options.range === "object") {
    start = options.range.start;
    end = options.range.end;
  } else {
    const eff = await getEffectiveAcademicYearRange(ref, options?.classId);
    start = eff.start;
    end = ref < eff.end ? ref : eff.end;
  }

  const endBoundary = new Date(
    Date.UTC(
      Number(toDateString(end).slice(0, 4)),
      Number(toDateString(end).slice(5, 7)) - 1,
      Number(toDateString(end).slice(8, 10)),
      23,
      59,
      59,
      999
    )
  );

  const [grouped, officialWorkingDays] = await Promise.all([
    prisma.attendance.groupBy({
      by: ["status"],
      where: {
        studentId,
        date: { gte: start, lte: endBoundary },
      },
      _count: { _all: true },
    }),
    countSchoolWorkingDays(start, endBoundary, options?.classId),
  ]);

  let presentCount = 0;
  let absentCount = 0;
  let lateCount = 0;
  let leaveCount = 0;

  for (const row of grouped) {
    const st = (row.status || "").toUpperCase();
    if (st === "PRESENT") presentCount += row._count._all;
    else if (st === "ABSENT") absentCount += row._count._all;
    else if (st === "LATE") lateCount += row._count._all;
    else if (st === "LEAVE") leaveCount += row._count._all;
  }

  return computeAttendanceMetrics({
    presentCount,
    absentCount,
    lateCount,
    leaveCount,
    officialWorkingDays,
  });
}

/**
 * Class-wide attendance percentage using exact student attendance sessions for active students.
 */
export async function getClassAttendanceSummary(
  classIds: string[],
  referenceDate: Date = new Date()
): Promise<Map<string, AttendanceStatsResult>> {
  const resultMap = new Map<string, AttendanceStatsResult>();
  if (classIds.length === 0) return resultMap;

  const uniqueClassIds = Array.from(new Set(classIds));
  const { start } = await getEffectiveAcademicYearRange(referenceDate, uniqueClassIds[0]);

  const [studentsPerClass, attendances] = await Promise.all([
    prisma.student.groupBy({
      by: ["classId"],
      where: { classId: { in: uniqueClassIds }, isActive: true },
      _count: { _all: true },
    }),
    prisma.attendance.findMany({
      where: {
        student: { classId: { in: uniqueClassIds }, isActive: true },
        date: { gte: start, lte: referenceDate },
      },
      select: {
        status: true,
        student: { select: { classId: true } },
      },
    }),
  ]);

  const studentCounts = new Map<string, number>();
  for (const row of studentsPerClass) {
    if (row.classId) studentCounts.set(row.classId, row._count._all);
  }

  const workingDaysPerClass = new Map<string, number>();
  await Promise.all(
    uniqueClassIds.map(async (cid) => {
      const wd = await countSchoolWorkingDays(start, referenceDate, cid);
      workingDaysPerClass.set(cid, wd);
    })
  );

  const groupedByClass = new Map<string, { status: string }[]>();
  for (const cid of uniqueClassIds) groupedByClass.set(cid, []);
  for (const att of attendances) {
    const cid = att.student.classId;
    if (cid && groupedByClass.has(cid)) {
      groupedByClass.get(cid)!.push({ status: att.status });
    }
  }

  for (const cid of uniqueClassIds) {
    const activeStudents = studentCounts.get(cid) || 0;
    const classWorkingDays = (workingDaysPerClass.get(cid) || 0) * Math.max(activeStudents, 0);
    const records = groupedByClass.get(cid) || [];
    resultMap.set(cid, summarizeAttendanceRecords(records, classWorkingDays));
  }

  return resultMap;
}
