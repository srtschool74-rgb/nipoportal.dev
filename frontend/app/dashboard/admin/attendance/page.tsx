import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { prisma } from "@/backend/db/prisma";
import AttendanceClient, { AdminStudentItem } from "./AttendanceClient";
import {
  getAcademicYearRange,
  getEffectiveAcademicYearRange,
  countSchoolWorkingDays,
  getLocalTodayDateString,
  toDateString,
} from "@/backend/lib/services/attendanceCalculation";
import { summarizeAttendanceRecords } from "@/backend/services/stats";

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string; date?: string }>;
}) {
  const session = await getServerSession(getAuthOptions());
  if (!session || session.user.role !== "ADMIN") return null;

  const resolvedSearchParams = await searchParams;

  const todayStr = resolvedSearchParams?.date || getLocalTodayDateString();
  const [year, month, day] = todayStr.split("-").map(Number);
  const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  // Fetch all active classes
  const classes = await prisma.class.findMany({
    where: { isActive: true },
    orderBy: [{ name: "asc" }, { section: "asc" }],
    select: { id: true, name: true, section: true },
  });

  const selectedClassId = resolvedSearchParams?.classId || (classes.length > 0 ? classes[0].id : "");

  // Determine official school working days up to current date for the selected class (starting from batch start date)
  const { start: academicStart } = await getEffectiveAcademicYearRange(startOfDay, selectedClassId);
  const officialWorkingDays = await countSchoolWorkingDays(academicStart, endOfDay, selectedClassId);

  let serializedStudents: AdminStudentItem[] = [];

  if (selectedClassId) {
    const rawStudents = await prisma.student.findMany({
      where: { classId: selectedClassId, isActive: true },
      include: {
        class: { select: { id: true, name: true, section: true } },
        attendances: {
          where: {
            date: {
              gte: academicStart,
              lte: endOfDay,
            },
          },
          orderBy: { date: "desc" },
        },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });

    serializedStudents = rawStudents.map((s) => {
      const todayRecords = s.attendances.filter((a) => {
        const attDate = toDateString(a.date);
        return attDate === todayStr;
      });

      const fnRecord = todayRecords.find((a) => {
        if (a.remarks?.toUpperCase().includes("AFTERNOON") || a.remarks?.includes("[AN]")) return false;
        if (a.remarks?.toUpperCase().includes("FORENOON") || a.remarks?.includes("[FN]")) return true;
        return new Date(a.date).getUTCHours() < 12;
      });

      const anRecord = todayRecords.find((a) => {
        if (a.remarks?.toUpperCase().includes("AFTERNOON") || a.remarks?.includes("[AN]")) return true;
        if (a.remarks?.toUpperCase().includes("FORENOON") || a.remarks?.includes("[FN]")) return false;
        return new Date(a.date).getUTCHours() >= 12;
      });

      const normalizeStatus = (st?: string | null): "PRESENT" | "ABSENT" | "LATE" | "NOT_MARKED" => {
        if (st === "PRESENT") return "PRESENT";
        if (st === "ABSENT") return "ABSENT";
        if (st === "LATE") return "LATE";
        if (st === "LEAVE") return "LATE";
        return "NOT_MARKED";
      };

      const forenoonStatus = normalizeStatus(fnRecord?.status);
      const afternoonStatus = normalizeStatus(anRecord?.status);

      const stats = summarizeAttendanceRecords(s.attendances, officialWorkingDays);

      return {
        id: s.id,
        name: `${s.firstName} ${s.lastName}`.trim(),
        rollNumber: s.rollNumber,
        admissionNo: s.admissionNo,
        classId: s.classId || selectedClassId,
        className: s.class ? `${s.class.name} - ${s.class.section}` : "",
        forenoonStatus,
        forenoonRemarks: fnRecord?.remarks || "",
        afternoonStatus,
        afternoonRemarks: anRecord?.remarks || "",
        currentStatus: forenoonStatus,
        currentRemarks: fnRecord?.remarks || "",
        attendancePercentage: stats.percentage,
        totalSessions: stats.totalWorkingSessions,
        presentCount: stats.presentCount,
        absentCount: stats.absentCount,
        lateCount: stats.lateCount,
        leaveCount: stats.leaveCount,
        recentHistory: s.attendances.slice(0, 30).map((a) => {
          const isAN = a.remarks?.toUpperCase().includes("AFTERNOON") || new Date(a.date).getUTCHours() >= 12;
          return {
            id: a.id,
            date: a.date,
            session: isAN ? "Afternoon" : "Forenoon",
            status: a.status === "LEAVE" ? "LATE" : a.status,
            remarks: a.remarks,
          };
        }),
      };
    });
  }

  return (
    <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}>
      <AttendanceClient
        classes={classes}
        students={serializedStudents}
        selectedClassId={selectedClassId}
        initialDate={todayStr}
      />
    </div>
  );
}
