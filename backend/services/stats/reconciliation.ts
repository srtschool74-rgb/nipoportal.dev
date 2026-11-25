import { prisma } from "@/backend/db/prisma";
import { SUPER_ADMIN_EMAILS } from "@/backend/lib/auth/superAdmin";
import { getDayScholarWhere } from "@/backend/lib/transport/dayScholarHelper";
import { getActiveStudentWhere, getAdminDashboardSummary } from "./coreCounts";
import { invalidateAllStatsCaches } from "./cache";
import { DataCheckIssue, ReconciliationSummaryReport } from "./types";

/**
 * Runs reconciliation checks across the entire database to catch data/count discrepancies:
 * - Super admins / non-parent users incorrectly carrying role='PARENT'
 * - Users with role='PARENT' missing a Parent profile row
 * - Parents with no active linked students
 * - Active students with no linked parents or no active class
 * - Active classes without a Class Teacher or with legacy teacherId mismatch
 * - Hostel or inactive students assigned to active buses
 * - Notification readAt vs isRead state drift
 */
export async function runDataReconciliationCheck(): Promise<ReconciliationSummaryReport> {
  const activeStudentWhere = getActiveStudentWhere();
  const counts = await getAdminDashboardSummary({ role: "ADMIN" });
  const issues: DataCheckIssue[] = [];

  const [
    superAdminMismatches,
    orphanParentUsers,
    parentsWithoutStudents,
    studentsWithoutParents,
    studentsWithoutClass,
    classesWithoutTeacher,
    legacyTeacherSyncClasses,
    invalidBusAssignments,
    notificationDriftCount,
  ] = await Promise.all([
    prisma.user.findMany({
      where: {
        email: { in: [...SUPER_ADMIN_EMAILS] },
        OR: [{ role: { not: "ADMIN" } }, { status: { not: "ACTIVE" } }],
      },
      select: { id: true, name: true, email: true, role: true, status: true },
    }),
    prisma.user.findMany({
      where: {
        role: "PARENT",
        parent: { is: null },
        email: { notIn: [...SUPER_ADMIN_EMAILS] },
      },
      select: { id: true, name: true, email: true, status: true },
    }),
    prisma.parent.findMany({
      where: {
        children: { none: { student: activeStudentWhere } },
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.student.findMany({
      where: {
        ...activeStudentWhere,
        parents: { none: {} },
      },
      select: { id: true, firstName: true, lastName: true, rollNumber: true },
    }),
    prisma.student.findMany({
      where: {
        ...activeStudentWhere,
        OR: [{ classId: null }, { class: { isActive: false } }],
      },
      select: { id: true, firstName: true, lastName: true, rollNumber: true },
    }),
    prisma.class.findMany({
      where: {
        isActive: true,
        classTeacherId: null,
        teacherId: null,
      },
      select: { id: true, name: true, section: true },
      orderBy: [{ name: "asc" }, { section: "asc" }],
    }),
    prisma.class.findMany({
      where: {
        isActive: true,
        teacherId: { not: null },
        classTeacherId: null,
      },
      select: { id: true, name: true, section: true, teacherId: true },
    }),
    prisma.busStudent.findMany({
      where: {
        bus: { isActive: true },
        NOT: { student: getDayScholarWhere() },
      },
      include: {
        bus: { select: { id: true, busNumber: true } },
        student: { select: { id: true, firstName: true, lastName: true, residenceType: true, isActive: true } },
      },
    }),
    prisma.notification.count({
      where: {
        OR: [
          { isRead: true, readAt: null },
          { isRead: false, readAt: { not: null } },
        ],
      },
    }),
  ]);

  for (const u of superAdminMismatches) {
    issues.push({
      id: `super-${u.id}`,
      category: "ROLE_MISMATCH",
      severity: "HIGH",
      title: `Super Admin "${u.name}" has role="${u.role}" (should be ADMIN)`,
      description: `Account ${u.email} is listed in SUPER_ADMIN_EMAILS but database role="${u.role}" (status="${u.status}"). This causes dashboard user-role count drift.`,
      recordId: u.id,
      canAutoFix: true,
      openHref: "/dashboard/admin/users",
    });
  }

  for (const u of orphanParentUsers) {
    issues.push({
      id: `orphan-parent-user-${u.id}`,
      category: "ORPHAN_PARENT_USER",
      severity: "HIGH",
      title: `Parent user "${u.name}" (${u.email}) has no Parent profile row`,
      description: `User has role="PARENT" without a matching row in Parent table, causing User-based counts to diverge from Parent Directory.`,
      recordId: u.id,
      canAutoFix: true,
      openHref: "/dashboard/admin/users",
    });
  }

  for (const p of parentsWithoutStudents) {
    issues.push({
      id: `parent-no-student-${p.id}`,
      category: "PARENT_WITHOUT_STUDENT",
      severity: "LOW",
      title: `Parent "${p.user.name}" has no active linked student`,
      description: `Parent account ${p.user.email} is present in Parent Directory with 0 active students.`,
      recordId: p.id,
      canAutoFix: false,
      openHref: `/dashboard/admin/parents/${p.id}`,
    });
  }

  for (const s of studentsWithoutParents) {
    issues.push({
      id: `student-no-parent-${s.id}`,
      category: "STUDENT_WITHOUT_PARENT",
      severity: "MEDIUM",
      title: `Student "${s.firstName} ${s.lastName}" (${s.rollNumber}) has no parent link`,
      description: `Active student is missing a ParentStudent record.`,
      recordId: s.id,
      canAutoFix: false,
      openHref: `/dashboard/admin/students?id=${s.id}`,
    });
  }

  for (const s of studentsWithoutClass) {
    issues.push({
      id: `student-no-class-${s.id}`,
      category: "STUDENT_WITHOUT_CLASS",
      severity: "MEDIUM",
      title: `Student "${s.firstName} ${s.lastName}" (${s.rollNumber}) has no active class`,
      description: `Active student is unassigned or attached to an inactive class.`,
      recordId: s.id,
      canAutoFix: false,
      openHref: `/dashboard/admin/students?id=${s.id}`,
    });
  }

  for (const c of legacyTeacherSyncClasses) {
    issues.push({
      id: `legacy-ct-${c.id}`,
      category: "LEGACY_CLASS_TEACHER_SYNC",
      severity: "MEDIUM",
      title: `${c.name} - ${c.section} has legacy teacherId without classTeacherId`,
      description: `Legacy teacherId is populated while canonical classTeacherId is null.`,
      recordId: c.id,
      canAutoFix: true,
      openHref: "/dashboard/admin/classes/reconciliation",
    });
  }

  for (const c of classesWithoutTeacher) {
    issues.push({
      id: `class-no-teacher-${c.id}`,
      category: "CLASS_WITHOUT_TEACHER",
      severity: "LOW",
      title: `${c.name} - ${c.section} has no Class Teacher assigned`,
      description: `Class section does not have a designated Class Teacher yet.`,
      recordId: c.id,
      canAutoFix: false,
      openHref: "/dashboard/admin/classes",
    });
  }

  for (const ba of invalidBusAssignments) {
    issues.push({
      id: `invalid-bus-${ba.id}`,
      category: "INVALID_BUS_ASSIGNMENT",
      severity: "HIGH",
      title: `${ba.student.firstName} ${ba.student.lastName} assigned to ${ba.bus.busNumber} despite not being an active Day Scholar`,
      description: `Residence=${ba.student.residenceType || "UNKNOWN"}, Active=${ba.student.isActive}. Bus counts restrict to active Day Scholars only.`,
      recordId: ba.id,
      canAutoFix: true,
      openHref: "/admin/buses",
    });
  }

  if (notificationDriftCount > 0) {
    issues.push({
      id: `notif-drift`,
      category: "NOTIFICATION_READ_DRIFT",
      severity: "MEDIUM",
      title: `${notificationDriftCount} notifications have isRead/readAt mismatch`,
      description: `Some notifications had isRead=true without readAt timestamp (or vice versa).`,
      recordId: "notifications",
      canAutoFix: true,
      openHref: "/dashboard/admin/notifications",
    });
  }

  const highSeverity = issues.filter((i) => i.severity === "HIGH").length;
  const autoFixable = issues.filter((i) => i.canAutoFix).length;

  return {
    checkedAt: new Date().toISOString(),
    counts,
    issues,
    summary: {
      totalIssues: issues.length,
      highSeverity,
      autoFixable,
    },
  };
}

/**
 * Safely executes auto-fix for a specific Data Check issue category.
 */
export async function fixDataCheckIssue(category: DataCheckIssue["category"], recordId: string) {
  let message = "Fixed successfully.";

  if (category === "ROLE_MISMATCH") {
    await prisma.user.update({
      where: { id: recordId },
      data: { role: "ADMIN", status: "ACTIVE" },
    });
    message = "Updated Super Admin database role to ADMIN.";
  } else if (category === "ORPHAN_PARENT_USER") {
    await prisma.parent.upsert({
      where: { userId: recordId },
      create: { userId: recordId, isActive: true },
      update: { isActive: true },
    });
    message = "Created missing Parent profile row for User.";
  } else if (category === "LEGACY_CLASS_TEACHER_SYNC") {
    const cls = await prisma.class.findUnique({ where: { id: recordId }, select: { teacherId: true } });
    if (cls?.teacherId) {
      await prisma.class.update({
        where: { id: recordId },
        data: { classTeacherId: cls.teacherId },
      });
    }
    message = "Synced canonical classTeacherId from legacy teacherId.";
  } else if (category === "INVALID_BUS_ASSIGNMENT") {
    await prisma.busStudent.delete({ where: { id: recordId } });
    message = "Removed invalid Hostel/Inactive student from bus roster.";
  } else if (category === "NOTIFICATION_READ_DRIFT") {
    await prisma.notification.updateMany({
      where: { isRead: true, readAt: null },
      data: { readAt: new Date() },
    });
    await prisma.notification.updateMany({
      where: { isRead: false, readAt: { not: null } },
      data: { isRead: true },
    });
    message = "Synced notification readAt and isRead timestamps.";
  } else {
    throw new Error("This issue requires manual assignment.");
  }

  await invalidateAllStatsCaches();
  return { success: true, message };
}
