/**
 * Safe Demo & Integrity Cleanup Script
 *
 * Default mode is DRY-RUN (read-only) — prints every finding without altering PostgreSQL.
 * Pass `--confirm` ONLY after inspecting dry-run output to perform safe fixes/deletions.
 *
 * Usage:
 *   npx tsx scripts/cleanup-demo-data.ts --dry-run
 *   npx tsx scripts/cleanup-demo-data.ts --confirm
 */
import "../backend/lib/loadEnv";
import { prisma } from "../backend/db/prisma";
import { SUPER_ADMIN_EMAILS } from "../backend/lib/auth/superAdmin";
import { getDayScholarWhere } from "../backend/lib/transport/dayScholarHelper";

const PROTECTED_EMAILS = new Set(SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase()));

async function main() {
  const isConfirm = process.argv.includes("--confirm");
  console.log("=========================================================================");
  console.log("          SRT PORTAL - SAFE DATA & DEMO CLEANUP DIAGNOSTIC");
  console.log(`Mode: ${isConfirm ? "LIVE EXECUTION (--confirm)" : "DRY-RUN PREVIEW (safe, read-only)"}`);
  console.log("=========================================================================\n");

  // 1. Live baseline snapshot
  const [students, teachers, parents, classes, subjects, admins] = await prisma.$transaction([
    prisma.student.count({ where: { isActive: true } }),
    prisma.teacher.count({ where: { isActive: true } }),
    prisma.parent.count(),
    prisma.class.count({ where: { isActive: true } }),
    prisma.subject.groupBy({ by: ["name"], where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.user.count({ where: { role: "ADMIN" } }),
  ]);

  console.log("Current Database Baseline:");
  console.log({
    activeStudents: students,
    activeTeachers: teachers,
    parentProfiles: parents,
    activeClassSections: classes,
    distinctActiveSubjects: subjects.length,
    adminUsers: admins,
  });
  console.log();

  // 2. Super Admin accounts holding wrong role or stray Parent row
  const mismatchedSuperAdmins = await prisma.user.findMany({
    where: {
      email: { in: [...SUPER_ADMIN_EMAILS] },
      OR: [{ role: { not: "ADMIN" } }, { parent: { isNot: null } }],
    },
    select: { id: true, email: true, role: true, parent: { select: { id: true } } },
  });

  // 3. Leftover demo/test records (never matching protected emails or real active classes/subjects)
  const testUsers = await prisma.user.findMany({
    where: {
      email: {
        notIn: [...PROTECTED_EMAILS],
        contains: "@test.",
      },
    },
    select: { id: true, email: true, role: true },
  });

  const testStudents = await prisma.student.findMany({
    where: {
      OR: [
        { admissionNo: { startsWith: "TEST-" } },
        { admissionNo: { startsWith: "__TEST" } },
        { firstName: { startsWith: "__TEST" } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, admissionNo: true },
  });

  // 4. Orphan Parent users (role=PARENT with missing Parent table row)
  const orphanParentUsers = await prisma.user.findMany({
    where: {
      role: "PARENT",
      parent: { is: null },
      email: { notIn: [...SUPER_ADMIN_EMAILS] },
    },
    select: { id: true, email: true, name: true },
  });

  // 5. Invalid bus assignments (Hostel or inactive students attached to buses)
  const invalidBusAssignments = await prisma.busStudent.findMany({
    where: {
      bus: { isActive: true },
      NOT: { student: getDayScholarWhere() },
    },
    select: {
      id: true,
      bus: { select: { busNumber: true } },
      student: { select: { firstName: true, lastName: true, residenceType: true, isActive: true } },
    },
  });

  // 6. Notification readAt vs isRead drift
  const driftNotifCount = await prisma.notification.count({
    where: {
      OR: [
        { isRead: true, readAt: null },
        { isRead: false, readAt: { not: null } },
      ],
    },
  });

  console.log("Findings:");
  console.log(`- Super Admin role mismatches:       ${mismatchedSuperAdmins.length}`);
  console.log(`- Test/demo '@test.*' users:         ${testUsers.length}`);
  console.log(`- Test/demo 'TEST-*' students:       ${testStudents.length}`);
  console.log(`- Orphan PARENT User rows (no profile): ${orphanParentUsers.length}`);
  console.log(`- Invalid Bus (non-DayScholar) links: ${invalidBusAssignments.length}`);
  console.log(`- Notification isRead/readAt drift:  ${driftNotifCount}`);

  if (!isConfirm) {
    console.log("\nDry-run complete. No records were modified.");
    console.log("Run `npx tsx scripts/cleanup-demo-data.ts --confirm` if any remediation above is intended.");
    return;
  }

  console.log("\nApplying safe remediations...");

  for (const sa of mismatchedSuperAdmins) {
    if (sa.parent?.id) {
      const childCount = await prisma.parentStudent.count({ where: { parentId: sa.parent.id } });
      if (childCount === 0) {
        await prisma.parent.delete({ where: { id: sa.parent.id } });
      }
    }
    await prisma.user.update({
      where: { id: sa.id },
      data: { role: "ADMIN", status: "ACTIVE" },
    });
    console.log(`Fixed Super Admin ${sa.email} -> role=ADMIN`);
  }

  for (const stu of testStudents) {
    await prisma.attendance.deleteMany({ where: { studentId: stu.id } });
    await prisma.mark.deleteMany({ where: { studentId: stu.id } });
    await prisma.reportCard.deleteMany({ where: { studentId: stu.id } });
    await prisma.parentStudent.deleteMany({ where: { studentId: stu.id } });
    await prisma.busStudent.deleteMany({ where: { studentId: stu.id } });
    await prisma.student.delete({ where: { id: stu.id } });
    console.log(`Removed test student ${stu.admissionNo}`);
  }

  if (testUsers.length > 0) {
    const ids = testUsers.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.parent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.teacher.deleteMany({ where: { userId: { in: ids } } });
    await prisma.staff.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`Removed ${testUsers.length} test user(s).`);
  }

  if (invalidBusAssignments.length > 0) {
    await prisma.busStudent.deleteMany({
      where: { id: { in: invalidBusAssignments.map((b) => b.id) } },
    });
    console.log(`Removed ${invalidBusAssignments.length} invalid bus assignment(s).`);
  }

  if (driftNotifCount > 0) {
    await prisma.notification.updateMany({
      where: { isRead: true, readAt: null },
      data: { readAt: new Date() },
    });
    await prisma.notification.updateMany({
      where: { isRead: false, readAt: { not: null } },
      data: { readAt: null },
    });
    console.log(`Synced notification readAt timestamps.`);
  }

  console.log("\nSafe cleanup finished cleanly.");
}

main()
  .catch((err) => {
    console.error("Cleanup script failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
