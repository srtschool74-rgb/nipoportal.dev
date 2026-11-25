import "@/backend/lib/loadEnv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/backend/db/prisma";
import {
  getAdminDashboardSummary,
  getClassCounts,
  getParentStats,
  getSubjectStats,
  getTeacherStats,
  getTotalStudents,
  getTransportFleetSummary,
  getUnreadNotificationStats,
  invalidateAllStatsCaches,
  listParentsPaginated,
  listStudentsPaginated,
  listTeachersPaginated,
  computeStudentExamResult,
  computeClassExamAnalytics,
  assignTiedRanks,
} from "@/backend/services/stats";

const TAG = `__CONSISTENCY_TEST_${Date.now()}__`;

describe("Single Stats Layer vs List Endpoints Consistency Proof", () => {
  const createdIds = {
    userIds: [] as string[],
    parentIds: [] as string[],
    teacherIds: [] as string[],
    classIds: [] as string[],
    studentIds: [] as string[],
    subjectIds: [] as string[],
    examIds: [] as string[],
    busIds: [] as string[],
  };

  let baseline: Awaited<ReturnType<typeof getAdminDashboardSummary>>;

  beforeAll(async () => {
    await invalidateAllStatsCaches();
    baseline = await getAdminDashboardSummary({ role: "ADMIN" });

    // 1. Create 2 Active Teachers + 1 Inactive Teacher
    for (let i = 1; i <= 3; i++) {
      const isActive = i <= 2;
      const u = await prisma.user.create({
        data: {
          email: `${TAG}_teacher_${i}@test.local`,
          name: `${TAG} Teacher ${i}`,
          password: "hashed-test-password",
          role: "TEACHER",
          status: isActive ? "ACTIVE" : "INACTIVE",
        },
      });
      createdIds.userIds.push(u.id);
      const t = await prisma.teacher.create({
        data: { userId: u.id, isActive },
      });
      createdIds.teacherIds.push(t.id);
    }

    // 2. Create 4 Active Classes
    for (let i = 1; i <= 4; i++) {
      const cls = await prisma.class.create({
        data: {
          name: `${TAG}-Grade`,
          section: `S${i}`,
          classTeacherId: i <= 2 ? createdIds.teacherIds[i - 1] : null,
          isActive: true,
        },
      });
      createdIds.classIds.push(cls.id);
    }

    // 3. Create 5 Subjects attached to Class 1 (tests 5-subject exam completeness)
    for (let i = 1; i <= 5; i++) {
      const sub = await prisma.subject.create({
        data: {
          name: `${TAG}-SUB-${i}`,
          code: `${TAG.slice(-6)}-${i}`,
          maxMarks: 100,
          passMarks: 35,
          classId: createdIds.classIds[0],
          teacherId: createdIds.teacherIds[0],
          isActive: true,
        },
      });
      createdIds.subjectIds.push(sub.id);
    }

    // 4. Create 3 Parents (Parent 1 & Parent 2 have active students; Parent 3 has 0 active students)
    for (let i = 1; i <= 3; i++) {
      const u = await prisma.user.create({
        data: {
          email: `${TAG}_parent_${i}@test.local`,
          name: `${TAG} Parent ${i}`,
          password: "hashed-test-password",
          role: "PARENT",
          status: "ACTIVE",
        },
      });
      createdIds.userIds.push(u.id);
      const p = await prisma.parent.create({
        data: { userId: u.id, isActive: true },
      });
      createdIds.parentIds.push(p.id);
    }

    // 5. Create 5 Active Students (4 Day Scholars, 1 Hosteler) + 1 Graduated Inactive Student
    for (let i = 1; i <= 6; i++) {
      const isGraduated = i === 6;
      const stu = await prisma.student.create({
        data: {
          rollNumber: `${TAG}-R${i}`,
          admissionNo: `${TAG}-A${i}`,
          firstName: `${TAG}`,
          lastName: `Student${i}`,
          classId: createdIds.classIds[(i - 1) % 4],
          residenceType: i === 5 ? "HOSTEL" : "DAYSCHOLAR",
          isActive: !isGraduated,
          enrollmentStatus: isGraduated ? "GRADUATED" : "ACTIVE",
        },
      });
      createdIds.studentIds.push(stu.id);

      // Link first 3 students to Parent 1, next 2 to Parent 2; leave Parent 3 unlinked
      const targetParentId = i <= 3 ? createdIds.parentIds[0] : i <= 5 ? createdIds.parentIds[1] : null;
      if (targetParentId) {
        await prisma.parentStudent.create({
          data: { parentId: targetParentId, studentId: stu.id },
        });
      }
    }

    // 6. Create Bus (capacity 30) and assign 2 Day Scholars
    const bus = await prisma.bus.create({
      data: {
        busNumber: `${TAG}-BUS1`,
        registrationNo: `${TAG}-REG1`,
        name: `${TAG} Express`,
        capacity: 30,
        driverName: "Test Driver",
        driverPhone: "9999999999",
        status: "RUNNING",
        isActive: true,
      },
    });
    createdIds.busIds.push(bus.id);

    for (let i = 0; i < 2; i++) {
      await prisma.busStudent.create({
        data: {
          busId: bus.id,
          studentId: createdIds.studentIds[i],
          academicYear: "2025-2026",
        },
      });
    }

    // 7. Create Exam with marks across all 5 subjects for first 3 students (2 tied at top, 1 failed in 1 subject)
    const exam = await prisma.exam.create({
      data: {
        name: `${TAG} MidTerm`,
        date: new Date("2026-09-10T00:00:00Z"),
        classId: createdIds.classIds[0],
        isPublished: true,
      },
    });
    createdIds.examIds.push(exam.id);

    const scoreRows = [
      // Student 0: 80 in all 5 = 400 (PASS)
      ...createdIds.subjectIds.map((subId) => ({
        studentId: createdIds.studentIds[0],
        examId: exam.id,
        subjectId: subId,
        score: 80,
        maxScore: 100,
      })),
      // Student 1: 80 in all 5 = 400 (PASS, tied Rank 1 with Student 0)
      ...createdIds.subjectIds.map((subId) => ({
        studentId: createdIds.studentIds[1],
        examId: exam.id,
        subjectId: subId,
        score: 80,
        maxScore: 100,
      })),
      // Student 2: 90, 90, 90, 90, 20 = 380 (76%, FAIL due to 20 < 35 in sub 5, Rank 3)
      ...createdIds.subjectIds.map((subId, idx) => ({
        studentId: createdIds.studentIds[2],
        examId: exam.id,
        subjectId: subId,
        score: idx === 4 ? 20 : 90,
        maxScore: 100,
      })),
    ];
    await prisma.mark.createMany({ data: scoreRows });

    // 8. Create 2 unread Notifications for Teacher 1's user
    await prisma.notification.createMany({
      data: [
        {
          userId: createdIds.userIds[0],
          title: `${TAG} Alert 1`,
          content: "Test alert 1",
          type: "GENERAL",
          category: "GENERAL",
          isRead: false,
          readAt: null,
        },
        {
          userId: createdIds.userIds[0],
          title: `${TAG} Alert 2`,
          content: "Test alert 2",
          type: "BUS",
          category: "BUS",
          isRead: false,
          readAt: null,
        },
      ],
    });

    await invalidateAllStatsCaches();
  }, 30000);

  afterAll(async () => {
    try {
      if (createdIds.examIds.length > 0) {
        await prisma.mark.deleteMany({ where: { examId: { in: createdIds.examIds } } });
        await prisma.reportCard.deleteMany({ where: { examId: { in: createdIds.examIds } } });
        await prisma.exam.deleteMany({ where: { id: { in: createdIds.examIds } } });
      }
      if (createdIds.busIds.length > 0) {
        await prisma.busStudent.deleteMany({ where: { busId: { in: createdIds.busIds } } });
        await prisma.bus.deleteMany({ where: { id: { in: createdIds.busIds } } });
      }
      if (createdIds.subjectIds.length > 0) {
        await prisma.subject.deleteMany({ where: { id: { in: createdIds.subjectIds } } });
      }
      if (createdIds.studentIds.length > 0) {
        await prisma.parentStudent.deleteMany({ where: { studentId: { in: createdIds.studentIds } } });
        await prisma.attendance.deleteMany({ where: { studentId: { in: createdIds.studentIds } } });
        await prisma.student.deleteMany({ where: { id: { in: createdIds.studentIds } } });
      }
      if (createdIds.classIds.length > 0) {
        await prisma.class.deleteMany({ where: { id: { in: createdIds.classIds } } });
      }
      if (createdIds.userIds.length > 0) {
        await prisma.notification.deleteMany({ where: { userId: { in: createdIds.userIds } } });
        await prisma.parent.deleteMany({ where: { userId: { in: createdIds.userIds } } });
        await prisma.teacher.deleteMany({ where: { userId: { in: createdIds.userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: createdIds.userIds } } });
      }
      await invalidateAllStatsCaches();
    } catch (cleanupErr) {
      console.error("Test cleanup error:", cleanupErr);
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);

  it("matches exact deltas for known created data (+5 active students, +2 active teachers, +3 parents, +4 classes, +5 subjects)", async () => {
    const after = await getAdminDashboardSummary({ role: "ADMIN" });

    expect(after.students.activeStudents - baseline.students.activeStudents).toBe(5);
    expect(after.students.allStudentsIncludingInactive - baseline.students.allStudentsIncludingInactive).toBe(6);
    expect(after.students.dayScholars - baseline.students.dayScholars).toBe(4);
    expect(after.students.hostelers - baseline.students.hostelers).toBe(1);

    expect(after.teachers.activeTeachers - baseline.teachers.activeTeachers).toBe(2);
    expect(after.teachers.allTeachersIncludingInactive - baseline.teachers.allTeachersIncludingInactive).toBe(3);

    expect(after.parents.totalParents - baseline.parents.totalParents).toBe(3);
    expect(after.parents.activeParents - baseline.parents.activeParents).toBe(2);
    expect(after.parents.parentsWithoutActiveStudents - baseline.parents.parentsWithoutActiveStudents).toBe(1);
    expect(after.parents.totalStudentsCount).toBe(after.students.activeStudents);

    expect(after.classes.totalSections - baseline.classes.totalSections).toBe(4);
    expect(after.classes.distinctClasses - baseline.classes.distinctClasses).toBe(1);

    expect(after.subjects.distinctSubjects - baseline.subjects.distinctSubjects).toBe(5);
    expect(after.subjects.totalAllocations - baseline.subjects.totalAllocations).toBe(5);
  });

  it("consistency rule: every Dashboard card equals its unfiltered List total", async () => {
    const [
      dash,
      studentStats,
      studentsList,
      teacherStats,
      teachersList,
      parentStats,
      parentsList,
      parentsActiveList,
      classStats,
      subjectStats,
    ] = await Promise.all([
      getAdminDashboardSummary({ role: "ADMIN" }),
      getTotalStudents({ role: "ADMIN" }),
      listStudentsPaginated({ role: "ADMIN" }, { status: "ACTIVE", page: 1, pageSize: 10 }),
      getTeacherStats({ role: "ADMIN" }),
      listTeachersPaginated({ role: "ADMIN" }, { status: "ACTIVE", page: 1, pageSize: 10 }),
      getParentStats({ role: "ADMIN" }),
      listParentsPaginated({ role: "ADMIN" }, { status: "ALL", page: 1, pageSize: 10 }),
      listParentsPaginated({ role: "ADMIN" }, { status: "ACTIVE", page: 1, pageSize: 10 }),
      getClassCounts({ role: "ADMIN" }),
      getSubjectStats({ role: "ADMIN" }),
    ]);

    expect(dash.students.activeStudents).toBe(studentStats.activeStudents);
    expect(dash.students.activeStudents).toBe(studentsList.total);
    expect(dash.teachers.activeTeachers).toBe(teacherStats.activeTeachers);
    expect(dash.teachers.activeTeachers).toBe(teachersList.total);
    expect(dash.parents.totalParents).toBe(parentStats.totalParents);
    expect(dash.parents.totalParents).toBe(parentsList.total);
    expect(dash.parents.activeParents).toBe(parentsActiveList.total);
    expect(dash.classes.totalSections).toBe(classStats.totalSections);
    expect(dash.subjects.distinctSubjects).toBe(subjectStats.distinctSubjects);
  });

  it("evaluates role-scoping accurately for Teacher and Parent portals", async () => {
    const teacherScope = { role: "TEACHER", teacherId: createdIds.teacherIds[0] };
    const teacherStudents = await getTotalStudents(teacherScope);
    // Teacher 0 has classTeacherOf=none via FK directly on classTeacherId: Class 0 only? Wait: Teacher 0 has Class 0 AND Class 0's students = Student 0 & Student 4 (indices 0, 4) -> 2 active students
    expect(teacherStudents.activeStudents).toBe(2);

    const parentScope = { role: "PARENT", parentId: createdIds.parentIds[0] };
    const parentStudents = await getTotalStudents(parentScope);
    expect(parentStudents.activeStudents).toBe(3);

    const unlinkedParent = { role: "PARENT", parentId: createdIds.parentIds[2] };
    expect((await getTotalStudents(unlinkedParent)).activeStudents).toBe(0);
  });

  it("computes exam pass/fail, tied ranks, and transport seats identically from DB rows", async () => {
    const examMarks = await prisma.mark.findMany({
      where: { examId: createdIds.examIds[0] },
      include: { subject: { select: { id: true, name: true, passMarks: true } } },
    });

    const classAnalytics = computeClassExamAnalytics(
      examMarks.map((m) => ({
        studentId: m.studentId,
        subjectId: m.subjectId,
        score: m.score,
        maxScore: m.maxScore,
        remarks: m.remarks,
        subject: m.subject,
      }))
    );

    expect(classAnalytics.totalStudentsAppeared).toBe(3);
    expect(classAnalytics.passedStudents).toBe(2);
    expect(classAnalytics.failedStudents).toBe(1);
    expect(classAnalytics.passRatePercentage).toBe(66.7);

    // Tied Rank Check
    const totals = [0, 1, 2].map((idx) => {
      const sid = createdIds.studentIds[idx];
      const sm = examMarks.filter((m) => m.studentId === sid);
      const evalRes = computeStudentExamResult(
        sm.map((m) => ({
          subjectId: m.subjectId,
          subjectName: m.subject.name,
          score: m.score,
          maxScore: m.maxScore,
          passMarks: m.subject.passMarks,
        }))
      );
      return { studentId: sid, totalMarks: evalRes.totalMarks, result: evalRes.result };
    });
    const ranked = assignTiedRanks(totals);
    expect(ranked.map((r) => [r.totalMarks, r.rank, r.result])).toEqual([
      [400, 1, "PASS"],
      [400, 1, "PASS"],
      [380, 3, "FAIL"],
    ]);

    const transportSummary = await getTransportFleetSummary();
    expect(transportSummary.totalAvailableSeats).toBe(
      Math.max(0, transportSummary.totalCapacity - transportSummary.totalAssignedDayScholars)
    );
  });

  it("tracks unread notifications accurately and drops count when readAt is recorded", async () => {
    const targetUserId = createdIds.userIds[0];
    const before = await getUnreadNotificationStats(targetUserId);
    expect(before.unreadCount).toBe(2);
    expect(before.busAlertCount).toBe(1);
    expect(before.hasBusAlert).toBe(true);

    await prisma.notification.updateMany({
      where: { userId: targetUserId, category: "BUS" },
      data: { isRead: true, readAt: new Date() },
    });

    const after = await getUnreadNotificationStats(targetUserId);
    expect(after.unreadCount).toBe(1);
    expect(after.busAlertCount).toBe(0);
    expect(after.hasBusAlert).toBe(false);
  });
});
