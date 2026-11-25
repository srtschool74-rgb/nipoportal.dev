import nextDynamic from "next/dynamic";
import { getCachedServerSession } from "@/backend/auth/sessionCache";
import { prisma } from "@/backend/db/prisma";
import { Prisma } from "@prisma/client";
import styles from "../dashboard.module.css";
import { Users, GraduationCap, BookOpen, Briefcase, Mail, Phone, CheckCircle2, XCircle, UserCheck, Gift } from "lucide-react";
import ClassSelector from "./ClassSelector";
import Link from "next/link";
import { redirect } from "next/navigation";
import { startOfSchoolDay, endOfSchoolDay, getSchoolNow } from "@/lib/time";
import { getAdminDashboardSummary, getParentStats, summarizeAttendanceRecords, computeStudentExamResult } from "@/backend/services/stats";
import { countSchoolWorkingDays, getEffectiveAcademicYearRange } from "@/backend/lib/services/attendanceCalculation";
import AdminDashboardStatsGrid from "@/frontend/components/admin/AdminDashboardStatsGrid";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PassFailChart = nextDynamic(() => import("./PassFailChart"), {
  loading: () => (
    <div style={{ height: "200px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>
      Loading test performance chart...
    </div>
  ),
});

const EditClassModal = nextDynamic(() => import("./EditClassModal"), {
  loading: () => <div style={{ height: "36px" }} />,
});

type StudentWithRelations = {
  id: string;
  rollNumber: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  parents: {
    parent: {
      id: string;
      phone: string | null;
      user: {
        id: string;
        name: string;
        email: string;
      };
    };
  }[];
  attendances: { status: string }[];
};

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string; page?: string }>;
}) {
  const session = await getCachedServerSession();
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const resolvedSearchParams = await searchParams;

  let dashboardSummary = {
    students: {
      activeStudents: 0,
      allStudentsIncludingInactive: 0,
      inactiveOrGraduatedStudents: 0,
      dayScholars: 0,
      hostelers: 0,
    },
    teachers: {
      activeTeachers: 0,
      allTeachersIncludingInactive: 0,
    },
    parents: {
      totalParents: 0,
      activeParents: 0,
      enabledParents: 0,
      parentsWithoutActiveStudents: 0,
      totalStudentsCount: 0,
    },
    classes: {
      totalSections: 0,
      distinctClasses: 0,
      sectionsWithClassTeacher: 0,
    },
    subjects: {
      distinctSubjects: 0,
      totalAllocations: 0,
    },
  };
  let classes: { id: string; name: string; section: string }[] = [];

  try {
    const [summaryRes, classesRes] = await Promise.all([
      getAdminDashboardSummary({ role: "ADMIN" }),
      prisma.class.findMany({
        where: { isActive: true },
        select: { id: true, name: true, section: true },
        orderBy: [{ name: 'asc' }, { section: 'asc' }]
      }).catch(() => [])
    ]);
    dashboardSummary = summaryRes;
    classes = classesRes;
  } catch (err) {
    console.error("Admin dashboard stats fetch error:", err);
  }

  let selectedClassData = null;
  let studentsData: StudentWithRelations[] = [];
  let teachersData: any[] = [];
  let passFailStats = null;
  const attendanceStats = { present: 0, absent: 0, total: 0 };
  let sectionCount = 0;
  let classParentsCount = 0;
  let totalClassStudents = 0;
  let officialClassWorkingDays = 0;
  let currentPage = 1;
  const pageSize = 20;
  let totalPages = 1;

  if (resolvedSearchParams.classId) {
    const classId = resolvedSearchParams.classId;
    currentPage = Math.max(1, parseInt(resolvedSearchParams.page || "1", 10));

    try {
      selectedClassData = await prisma.class.findUnique({
        where: { id: classId },
        select: {
          id: true,
          name: true,
          section: true,
          teacherId: true,
          teacher: {
            select: {
              id: true,
              phone: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      }).catch(() => null);

      if (selectedClassData) {
        const todayStart = startOfSchoolDay();
        const todayEnd = endOfSchoolDay();
        const { start: academicStart } = await getEffectiveAcademicYearRange(todayEnd, classId);

        const [
          sectionCountRes,
          totalClassStudentsRes,
          studentsDataRes,
          teachersDataRes,
          todaysAttendancesRes,
          marksRes,
          classParentStatsRes,
          workingDaysRes,
        ] = await Promise.all([
          prisma.class.count({ where: { name: selectedClassData.name, isActive: true } }).catch(() => 0),
          prisma.student.count({
            where: {
              classId,
              isActive: true,
              OR: [{ enrollmentStatus: null }, { enrollmentStatus: { notIn: ["GRADUATED", "TRANSFERRED"] } }],
            },
          }).catch(() => 0),
          prisma.student.findMany({
            where: {
              classId,
              isActive: true,
              OR: [{ enrollmentStatus: null }, { enrollmentStatus: { notIn: ["GRADUATED", "TRANSFERRED"] } }],
            },
            orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
            take: pageSize,
            skip: (currentPage - 1) * pageSize,
            select: {
              id: true,
              rollNumber: true,
              firstName: true,
              lastName: true,
              isActive: true,
              parents: {
                select: {
                  parent: {
                    select: {
                      id: true,
                      phone: true,
                      user: {
                        select: {
                          id: true,
                          name: true,
                          email: true,
                        },
                      },
                    },
                  },
                },
              },
              attendances: {
                where: { date: { gte: academicStart, lte: todayEnd } },
                select: { status: true },
              },
            },
          }).catch(() => []),
          prisma.teacher.findMany({
            where: { isActive: true },
            select: {
              id: true,
              userId: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
            orderBy: { user: { name: 'asc' } },
          }).catch(() => []),
          prisma.attendance.findMany({
            where: {
              OR: [
                { classId },
                { student: { classId } },
              ],
              date: { gte: todayStart, lte: todayEnd },
            },
            select: { status: true },
          }).catch(() => []),
          prisma.mark.findMany({
            where: { student: { classId, isActive: true } },
            select: {
              studentId: true,
              examId: true,
              subjectId: true,
              score: true,
              maxScore: true,
              remarks: true,
              subject: { select: { id: true, name: true, passMarks: true } },
            },
            orderBy: { createdAt: 'desc' },
          }).catch(() => []),
          getParentStats({ role: "ADMIN" }, { classId }).catch(() => ({
            totalParents: 0,
            activeParents: 0,
            enabledParents: 0,
            parentsWithoutActiveStudents: 0,
            totalStudentsCount: 0,
          })),
          countSchoolWorkingDays(academicStart, todayEnd, classId).catch(() => 0),
        ]);

        sectionCount = sectionCountRes;
        totalClassStudents = totalClassStudentsRes;
        totalPages = Math.max(1, Math.ceil(totalClassStudents / pageSize));
        studentsData = (studentsDataRes || []) as any;
        teachersData = teachersDataRes || [];
        officialClassWorkingDays = workingDaysRes || 0;
        const todaysAttendances = todaysAttendancesRes || [];
        const marks = marksRes || [];

        attendanceStats.total = totalClassStudents;
        todaysAttendances.forEach(att => {
          if (att.status === 'PRESENT' || att.status === 'LATE') attendanceStats.present++;
          if (att.status === 'ABSENT' || att.status === 'LEAVE') attendanceStats.absent++;
        });

        classParentsCount = classParentStatsRes.totalParents;

        let passCount = 0;
        let failCount = 0;

        const studentExams = new Map<string, Array<{ subjectId: string; subjectName: string; score: number; maxScore: number; passMarks: number; absent: boolean; remarks?: string | null }>>();
        marks.forEach((m) => {
          const key = `${m.studentId}-${m.examId}`;
          const list = studentExams.get(key) || [];
          const isAbsent = (m.remarks || "").trim().toUpperCase() === "ABSENT";
          list.push({
            subjectId: m.subjectId,
            subjectName: m.subject?.name || "Subject",
            score: m.score,
            maxScore: m.maxScore,
            passMarks: m.subject?.passMarks ?? 35,
            absent: isAbsent,
            remarks: m.remarks,
          });
          studentExams.set(key, list);
        });

        studentExams.forEach((subjectsList) => {
          const res = computeStudentExamResult(subjectsList);
          if (res.result === "PASS") passCount++;
          else failCount++;
        });

        passFailStats = [
          { name: 'Pass', value: passCount, color: "var(--success)" },
          { name: 'Fail', value: failCount, color: "var(--danger)" }
        ];
      }
    } catch (classFetchErr) {
      console.error("Admin selected class data fetch error:", classFetchErr);
    }
  }

  // School birthday check in Asia/Kolkata
  const schoolToday = getSchoolNow();
  const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
  const isNonLeapFeb28 = !isLeap(schoolToday.year) && schoolToday.month === 2 && schoolToday.day === 28;

  let adminUser: { dateOfBirth: Date | null; name: string | null } | null = null;
  let birthdayStudentCount: Array<{ count: bigint | number }> = [{ count: 0 }];
  let birthdayTeacherCount: Array<{ count: bigint | number }> = [{ count: 0 }];
  let birthdayStaffCount: Array<{ count: bigint | number }> = [{ count: 0 }];

  try {
    const birthdayResults = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { dateOfBirth: true, name: true },
      }).catch(() => null),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as "count" FROM "Student" s
        WHERE s."isActive" = true AND s."dateOfBirth" IS NOT NULL
          AND ((EXTRACT(MONTH FROM s."dateOfBirth") = ${schoolToday.month} AND EXTRACT(DAY FROM s."dateOfBirth") = ${schoolToday.day})
               ${isNonLeapFeb28 ? Prisma.sql`OR (EXTRACT(MONTH FROM s."dateOfBirth") = 2 AND EXTRACT(DAY FROM s."dateOfBirth") = 29)` : Prisma.empty});
      `.catch(() => [{ count: BigInt(0) }]),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as "count" FROM "Teacher" t
        JOIN "User" u ON t."userId" = u."id"
        WHERE t."isActive" = true AND u."status" = 'ACTIVE'
          AND COALESCE(t."dateOfBirth", u."dateOfBirth") IS NOT NULL
          AND ((EXTRACT(MONTH FROM COALESCE(t."dateOfBirth", u."dateOfBirth")) = ${schoolToday.month} AND EXTRACT(DAY FROM COALESCE(t."dateOfBirth", u."dateOfBirth")) = ${schoolToday.day})
               ${isNonLeapFeb28 ? Prisma.sql`OR (EXTRACT(MONTH FROM COALESCE(t."dateOfBirth", u."dateOfBirth")) = 2 AND EXTRACT(DAY FROM COALESCE(t."dateOfBirth", u."dateOfBirth")) = 29)` : Prisma.empty});
      `.catch(() => [{ count: BigInt(0) }]),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as "count" FROM "Staff" st
        JOIN "User" u ON st."userId" = u."id"
        WHERE st."isActive" = true AND u."status" = 'ACTIVE'
          AND COALESCE(st."dateOfBirth", u."dateOfBirth") IS NOT NULL
          AND ((EXTRACT(MONTH FROM COALESCE(st."dateOfBirth", u."dateOfBirth")) = ${schoolToday.month} AND EXTRACT(DAY FROM COALESCE(st."dateOfBirth", u."dateOfBirth")) = ${schoolToday.day})
               ${isNonLeapFeb28 ? Prisma.sql`OR (EXTRACT(MONTH FROM COALESCE(st."dateOfBirth", u."dateOfBirth")) = 2 AND EXTRACT(DAY FROM COALESCE(st."dateOfBirth", u."dateOfBirth")) = 29)` : Prisma.empty});
      `.catch(() => [{ count: BigInt(0) }]),
    ]);
    adminUser = birthdayResults[0];
    birthdayStudentCount = birthdayResults[1];
    birthdayTeacherCount = birthdayResults[2];
    birthdayStaffCount = birthdayResults[3];
  } catch (bErr) {
    console.error("Admin birthday check error:", bErr);
  }

  let isAdminBirthday = false;
  if (adminUser?.dateOfBirth) {
    const ad = new Date(adminUser.dateOfBirth);
    const am = ad.getUTCMonth() + 1;
    const aday = ad.getUTCDate();
    if (am === schoolToday.month && aday === schoolToday.day) isAdminBirthday = true;
    if (isNonLeapFeb28 && am === 2 && aday === 29) isAdminBirthday = true;
  }

  const totalSchoolCelebrantsToday =
    Number(birthdayStudentCount[0]?.count || 0) +
    Number(birthdayTeacherCount[0]?.count || 0) +
    Number(birthdayStaffCount[0]?.count || 0);

  return (
    <div className={styles.dashboard}>
      <h1 className={styles.title}>Admin Dashboard</h1>

      {/* Admin Birthday Card */}
      {isAdminBirthday && (
        <div style={{
          background: "linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%)",
          border: "1px solid #f59e0b",
          borderRadius: "14px",
          padding: "1.25rem 1.5rem",
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 4px 12px rgba(245, 158, 11, 0.15)",
          color: "#78350f"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ fontSize: "2rem" }}>🎂</div>
            <div>
              <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "#92400e" }}>
                Happy Birthday, {adminUser?.name || "Administrator"}! 🎉
              </div>
              <div style={{ fontSize: "0.85rem", color: "#b45309", marginTop: "2px" }}>
                SRT School wishes you a prosperous, healthy, and successful year ahead! Thank you for your leadership and guidance.
              </div>
            </div>
          </div>
          <span style={{ fontSize: "0.75rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", background: "#f59e0b", color: "#ffffff" }}>
            SRT School Wishes You
          </span>
        </div>
      )}

      {/* School Birthday Celebrants Today Banner */}
      {totalSchoolCelebrantsToday > 0 && (
        <div style={{
          background: "linear-gradient(135deg, #ede9fe 0%, #f3e8ff 100%)",
          border: "1px solid #8b5cf6",
          borderRadius: "14px",
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
          boxShadow: "0 2px 8px rgba(139, 92, 246, 0.1)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Gift size={22} style={{ color: "#7c3aed" }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#5b21b6" }}>
                Today&apos;s School Birthday Celebrants: {totalSchoolCelebrantsToday} person{totalSchoolCelebrantsToday > 1 ? "s" : ""}
              </div>
              <div style={{ fontSize: "0.82rem", color: "#6d28d9" }}>
                {Number(birthdayStudentCount[0]?.count || 0)} Students, {Number(birthdayTeacherCount[0]?.count || 0)} Teachers, {Number(birthdayStaffCount[0]?.count || 0)} Staff
              </div>
            </div>
          </div>
          <Link
            href="/dashboard/admin/settings/birthdays"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.45rem 0.9rem",
              borderRadius: "8px",
              background: "#7c3aed",
              color: "#ffffff",
              textDecoration: "none",
              fontSize: "0.8rem",
              fontWeight: 600
            }}
          >
            Manage Birthday Wishes
          </Link>
        </div>
      )}

      <AdminDashboardStatsGrid initialSummary={dashboardSummary} />

      <div style={{ marginTop: "2rem", display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'center', marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Class Overview</h2>
        {selectedClassData && (
          <EditClassModal classData={selectedClassData as any} teachers={teachersData as any} />
        )}
      </div>
      <div style={{ marginBottom: "2rem" }}>
        <ClassSelector classes={classes} />
      </div>

      {selectedClassData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Class Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.25rem', background: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Class Name</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 600 }}>{selectedClassData.name}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Section</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 600 }}>{selectedClassData.section}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Total Strength</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 600 }}>{totalClassStudents}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Class Parents</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--primary)' }}>{classParentsCount}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Total Sections for {selectedClassData.name}</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 600 }}>{sectionCount}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Today&apos;s Attendance</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                {attendanceStats.present} <span style={{ fontSize: '1rem', color: "var(--success)" }}>Present</span> / {attendanceStats.absent} <span style={{ fontSize: '1rem', color: "var(--danger)" }}>Absent</span>
              </p>
            </div>
          </div>

          <div className={styles.chartsContainer}>
            {/* Class Teacher Card */}
            {selectedClassData.teacher && (
              <div style={{ background: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Briefcase size={20} className="text-indigo-500" />
                  Class Teacher Profile
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
                  <div style={{ width: '70px', height: '70px', borderRadius: '50%', background: 'var(--primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', color: 'var(--primary)', flexShrink: 0 }}>
                    {selectedClassData.teacher.user.name.charAt(0)}
                  </div>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <h4 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0, overflowWrap: 'anywhere' }}>{selectedClassData.teacher.user.name}</h4>
                    <p style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem', marginBottom: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
                      <Mail size={16} style={{ flexShrink: 0 }} />
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-all' }}>{selectedClassData.teacher.user.email}</span>
                    </p>
                    {selectedClassData.teacher.phone && (
                      <p style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem', marginBottom: 0, minWidth: 0 }}>
                        <Phone size={16} style={{ flexShrink: 0 }} />
                        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{selectedClassData.teacher.phone}</span>
                      </p>
                    )}
                  </div>
                  <Link href={`/dashboard/admin/teachers?id=${selectedClassData.teacher.id}`} style={{ padding: '0.5rem 1rem', background: "var(--primary)", color: "var(--primary-fg)", borderRadius: '6px', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    View Teacher Details
                  </Link>
                </div>
              </div>
            )}

            {/* Test Overview Chart */}
            <div style={{ background: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>Test Performance Overview</h3>
              <div style={{ height: '200px', minWidth: 0 }}>
                <PassFailChart data={passFailStats} />
              </div>
            </div>
          </div>

          {/* Student Table */}
          <div style={{ background: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', overflowWrap: 'anywhere' }}>Students in {selectedClassData.name} - {selectedClassData.section}</h3>
            <div style={{ width: '100%', maxWidth: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Roll No.</th>
                    <th style={{ padding: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Name</th>
                    <th style={{ padding: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Linked Parent(s)</th>
                    <th style={{ padding: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Parent Contact</th>
                    <th style={{ padding: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Attendance %</th>
                    <th style={{ padding: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {studentsData.map(student => {
                    const attStats = summarizeAttendanceRecords(student.attendances, officialClassWorkingDays);
                    const attPercent = attStats.percentageValue ?? 0;

                    return (
                      <tr key={student.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.75rem' }}>{student.rollNumber}</td>
                        <td style={{ padding: '0.75rem', fontWeight: 500 }}>
                          <Link href={`/dashboard/admin/students?id=${student.id}`} style={{ color: 'var(--primary)', textDecoration: 'none' }}>
                            {student.firstName} {student.lastName}
                          </Link>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          {student.parents.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              {student.parents.map((ps, idx) => (
                                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{ps.parent.user.name}</span>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>({ps.parent.user.email})</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>No parent linked</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          {student.parents.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              {student.parents.map((ps, idx) => (
                                <div key={idx} style={{ fontSize: '0.85rem' }}>
                                  {ps.parent.phone ? (
                                    <span>{ps.parent.phone}</span>
                                  ) : (
                                    <span style={{ color: 'var(--text-secondary)' }}>-</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)' }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <span style={{ color: attStats.hasWorkingSessions ? (attPercent >= 75 ? "var(--success)" : attPercent >= 60 ? "var(--warning)" : "var(--danger)") : "var(--text-secondary)", fontWeight: 600 }}>
                            {attStats.percentage}%
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          {student.isActive ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: "var(--success)", fontSize: '0.875rem', background: 'var(--success-bg)', padding: '0.25rem 0.5rem', borderRadius: '999px' }}>
                              <CheckCircle2 size={14} /> Active
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: "var(--danger)", fontSize: '0.875rem', background: 'var(--danger-bg)', padding: '0.25rem 0.5rem', borderRadius: '999px' }}>
                              <XCircle size={14} /> Inactive
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {studentsData.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No students found in this class.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingTop: "1rem",
                  marginTop: "1rem",
                  borderTop: "1px solid var(--border-color)",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                }}
              >
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalClassStudents)} of {totalClassStudents} students
                </span>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  {currentPage > 1 ? (
                    <Link
                      href={`/dashboard/admin?classId=${selectedClassData.id}&page=${currentPage - 1}`}
                      style={{
                        padding: "0.4rem 0.8rem",
                        borderRadius: "6px",
                        background: "var(--card-bg)",
                        border: "1px solid var(--border-color)",
                        color: "var(--text-primary)",
                        textDecoration: "none",
                        fontSize: "0.82rem",
                      }}
                    >
                      Previous
                    </Link>
                  ) : (
                    <span
                      style={{
                        padding: "0.4rem 0.8rem",
                        borderRadius: "6px",
                        background: "rgba(255, 255, 255, 0.03)",
                        border: "1px solid var(--border-color)",
                        color: "var(--text-secondary)",
                        opacity: 0.5,
                        fontSize: "0.82rem",
                        cursor: "not-allowed",
                      }}
                    >
                      Previous
                    </span>
                  )}
                  <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)", padding: "0 0.5rem" }}>
                    Page {currentPage} of {totalPages}
                  </span>
                  {currentPage < totalPages ? (
                    <Link
                      href={`/dashboard/admin?classId=${selectedClassData.id}&page=${currentPage + 1}`}
                      style={{
                        padding: "0.4rem 0.8rem",
                        borderRadius: "6px",
                        background: "var(--card-bg)",
                        border: "1px solid var(--border-color)",
                        color: "var(--text-primary)",
                        textDecoration: "none",
                        fontSize: "0.82rem",
                      }}
                    >
                      Next
                    </Link>
                  ) : (
                    <span
                      style={{
                        padding: "0.4rem 0.8rem",
                        borderRadius: "6px",
                        background: "rgba(255, 255, 255, 0.03)",
                        border: "1px solid var(--border-color)",
                        color: "var(--text-secondary)",
                        opacity: 0.5,
                        fontSize: "0.82rem",
                        cursor: "not-allowed",
                      }}
                    >
                      Next
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
