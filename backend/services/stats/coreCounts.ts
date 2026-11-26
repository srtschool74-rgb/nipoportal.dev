import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/backend/db/prisma";
import { getDayScholarWhere } from "@/backend/lib/transport/dayScholarHelper";
import { withShortStatsCache } from "./cache";
import {
  AdminDashboardSummary,
  ClassStatsSummary,
  CoreCountsFilters,
  PaginatedResult,
  ParentStatsSummary,
  StatsScope,
  StudentStatsSummary,
  SubjectStatsSummary,
  TeacherStatsSummary,
} from "./types";

/**
 * Active enrolled students (excludes deactivated and graduated/transferred alumni).
 */
export function getActiveStudentWhere(filters?: {
  classId?: string;
  batch?: string;
}): Prisma.StudentWhereInput {
  return {
    isActive: true,
    OR: [
      { enrollmentStatus: null },
      { enrollmentStatus: { notIn: ["GRADUATED", "TRANSFERRED"] } },
    ],
    ...(filters?.classId && filters.classId !== "ALL" ? { classId: filters.classId } : {}),
    ...(filters?.batch && filters.batch !== "ALL" ? { batch: filters.batch } : {}),
  };
}

/**
 * Resolves class IDs accessible to a Teacher (classTeacherOf + classes + assigned subject classes).
 */
export async function getTeacherAccessibleClassIds(teacherId: string): Promise<string[]> {
  if (!teacherId) return [];
  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    select: {
      classTeacherOf: { where: { isActive: true }, select: { id: true } },
      classes: { where: { isActive: true }, select: { id: true } },
      subjects: {
        where: { isActive: true },
        select: { classId: true, class: { select: { isActive: true } } },
      },
    },
  });
  if (!teacher) return [];

  const ids = new Set<string>();
  if (teacher.classTeacherOf?.id) ids.add(teacher.classTeacherOf.id);
  for (const c of teacher.classes) ids.add(c.id);
  for (const s of teacher.subjects) {
    if (s.classId && s.class?.isActive) ids.add(s.classId);
  }
  return Array.from(ids);
}

/**
 * Resolves active Student IDs belonging to a Parent.
 */
async function getParentStudentIds(parentId: string): Promise<string[]> {
  if (!parentId) return [];
  const links = await prisma.parentStudent.findMany({
    where: { parentId, student: getActiveStudentWhere() },
    select: { studentId: true },
  });
  return links.map((l) => l.studentId);
}

/**
 * Builds role-scoped Prisma StudentWhereInput cleanly.
 */
export async function buildScopedStudentWhere(
  scope: StatsScope,
  filters: CoreCountsFilters = {}
): Promise<Prisma.StudentWhereInput> {
  const role = String(scope.role || "").toUpperCase();
  const status = filters.status || "ACTIVE";

  const baseWhere: Prisma.StudentWhereInput =
    status === "ACTIVE"
      ? getActiveStudentWhere({ classId: filters.classId, batch: filters.batch })
      : status === "INACTIVE"
      ? {
          OR: [
            { isActive: false },
            { enrollmentStatus: { in: ["GRADUATED", "TRANSFERRED"] } },
          ],
          ...(filters.classId && filters.classId !== "ALL" ? { classId: filters.classId } : {}),
          ...(filters.batch && filters.batch !== "ALL" ? { batch: filters.batch } : {}),
        }
      : {
          ...(filters.classId && filters.classId !== "ALL" ? { classId: filters.classId } : {}),
          ...(filters.batch && filters.batch !== "ALL" ? { batch: filters.batch } : {}),
        };

  if (filters.search?.trim()) {
    const q = filters.search.trim();
    baseWhere.AND = [
      {
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { rollNumber: { contains: q, mode: "insensitive" } },
          { admissionNo: { contains: q, mode: "insensitive" } },
          {
            parents: {
              some: {
                parent: {
                  OR: [
                    { phone: { contains: q, mode: "insensitive" } },
                    { user: { name: { contains: q, mode: "insensitive" } } },
                    { user: { email: { contains: q, mode: "insensitive" } } },
                  ],
                },
              },
            },
          },
        ],
      },
    ];
  }

  if (role === "TEACHER") {
    const tid =
      scope.teacherId ||
      (scope.userId
        ? (
            await prisma.teacher.findUnique({
              where: { userId: scope.userId },
              select: { id: true },
            })
          )?.id
        : undefined);
    const allowedClassIds = tid ? await getTeacherAccessibleClassIds(tid) : [];
    if (allowedClassIds.length === 0) return { id: "__none__" };
    return {
      AND: [
        baseWhere,
        {
          classId:
            filters.classId && filters.classId !== "ALL" && allowedClassIds.includes(filters.classId)
              ? filters.classId
              : { in: allowedClassIds },
        },
      ],
    };
  }

  if (role === "PARENT") {
    const pid =
      scope.parentId ||
      (scope.userId
        ? (
            await prisma.parent.findUnique({
              where: { userId: scope.userId },
              select: { id: true },
            })
          )?.id
        : undefined);
    const childIds = pid ? await getParentStudentIds(pid) : [];
    if (childIds.length === 0) return { id: "__none__" };
    return { AND: [baseWhere, { id: { in: childIds } }] };
  }

  return baseWhere;
}

/**
 * Single Source of Truth: Total Student counts using SQL aggregate counts.
 */
export async function getTotalStudents(
  scope: StatsScope = { role: "ADMIN" },
  filters: { classId?: string; batch?: string } = {}
): Promise<StudentStatsSummary> {
  const role = String(scope.role || "").toUpperCase();
  const cacheKey = `students:${role}:${scope.userId || scope.teacherId || scope.parentId || "all"}:${filters.classId || "all"}:${filters.batch || "all"}`;

  return withShortStatsCache(cacheKey, async () => {
    const [activeWhere, allWhere] = await Promise.all([
      buildScopedStudentWhere(scope, { ...filters, status: "ACTIVE" }),
      buildScopedStudentWhere(scope, { ...filters, status: "ALL" }),
    ]);

    const dayScholarWhere: Prisma.StudentWhereInput = {
      AND: [activeWhere, getDayScholarWhere()],
    };
    const hostelerWhere: Prisma.StudentWhereInput = {
      AND: [
        activeWhere,
        { residenceType: { in: ["HOSTEL", "HOSTELER", "Hostel", "hostel"] } },
      ],
    };

    const [activeStudents, allStudentsIncludingInactive, dayScholars, hostelers] =
      await prisma.$transaction([
        prisma.student.count({ where: activeWhere }),
        prisma.student.count({ where: allWhere }),
        prisma.student.count({ where: dayScholarWhere }),
        prisma.student.count({ where: hostelerWhere }),
      ]);

    return {
      activeStudents,
      allStudentsIncludingInactive,
      inactiveOrGraduatedStudents: Math.max(0, allStudentsIncludingInactive - activeStudents),
      dayScholars,
      hostelers,
    };
  });
}

/**
 * Single Source of Truth: Teacher aggregate counts.
 */
export async function getTeacherStats(
  scope: StatsScope = { role: "ADMIN" }
): Promise<TeacherStatsSummary> {
  const role = String(scope.role || "").toUpperCase();
  const cacheKey = `teachers:${role}:${scope.userId || "all"}`;

  return withShortStatsCache(cacheKey, async () => {
    const baseScopeWhere: Prisma.TeacherWhereInput =
      role === "TEACHER" && scope.userId ? { userId: scope.userId } : {};

    const [activeTeachers, allTeachersIncludingInactive] = await prisma.$transaction([
      prisma.teacher.count({
        where: {
          ...baseScopeWhere,
          isActive: true,
          user: { status: "ACTIVE" },
        },
      }),
      prisma.teacher.count({ where: baseScopeWhere }),
    ]);

    return { activeTeachers, allTeachersIncludingInactive };
  });
}

/**
 * Single Source of Truth: Parent aggregate counts.
 * Queries ONLY the canonical Parent table so Admin Dashboard and Admin > Parents
 * ALWAYS show identical numbers (never counts Super Admin / non-Parent User rows).
 */
export async function getParentStats(
  scope: StatsScope = { role: "ADMIN" },
  filters: { classId?: string; status?: "ALL" | "ACTIVE" | "INACTIVE" } = {}
): Promise<ParentStatsSummary> {
  const role = String(scope.role || "").toUpperCase();
  const cacheKey = `parents:${role}:${scope.userId || scope.teacherId || "all"}:${filters.classId || "all"}:${filters.status || "ALL"}`;

  return withShortStatsCache(cacheKey, async () => {
    let scopedClassIds: string[] | undefined;
    if (role === "TEACHER") {
      const tid =
        scope.teacherId ||
        (scope.userId
          ? (
              await prisma.teacher.findUnique({
                where: { userId: scope.userId },
                select: { id: true },
              })
            )?.id
          : undefined);
      scopedClassIds = tid ? await getTeacherAccessibleClassIds(tid) : [];
      if (scopedClassIds.length === 0) {
        return {
          totalParents: 0,
          activeParents: 0,
          enabledParents: 0,
          parentsWithoutActiveStudents: 0,
          totalStudentsCount: 0,
        };
      }
    }

    const activeStudentConstraint = getActiveStudentWhere({
      classId: filters.classId,
    });

    const baseWhere: Prisma.ParentWhereInput =
      role === "PARENT" && scope.userId
        ? { userId: scope.userId }
        : role === "TEACHER" && scopedClassIds
        ? { children: { some: { student: { ...activeStudentConstraint, classId: { in: scopedClassIds } } } } }
        : filters.classId && filters.classId !== "ALL"
        ? { children: { some: { student: activeStudentConstraint } } }
        : {};

    const studentStats = await getTotalStudents(scope, { classId: filters.classId });

    const [totalParents, enabledParents, activeParents, parentsWithActiveStudents] =
      await prisma.$transaction([
        prisma.parent.count({ where: baseWhere }),
        prisma.parent.count({
          where: {
            ...baseWhere,
            isActive: true,
            user: { status: "ACTIVE" },
          },
        }),
        prisma.parent.count({
          where: {
            ...baseWhere,
            isActive: true,
            user: { status: "ACTIVE" },
            children: { some: { student: activeStudentConstraint } },
          },
        }),
        prisma.parent.count({
          where: {
            ...baseWhere,
            children: { some: { student: activeStudentConstraint } },
          },
        }),
      ]);

    return {
      totalParents,
      activeParents,
      enabledParents,
      parentsWithoutActiveStudents: Math.max(0, totalParents - parentsWithActiveStudents),
      totalStudentsCount: studentStats.activeStudents,
    };
  });
}

/**
 * Single Source of Truth: Classes & Sections aggregate counts.
 */
export async function getClassCounts(
  scope: StatsScope = { role: "ADMIN" },
  filters: { batchId?: string } = {}
): Promise<ClassStatsSummary> {
  const role = String(scope.role || "").toUpperCase();
  const cacheKey = `classes:${role}:${scope.userId || scope.teacherId || scope.parentId || "all"}:${filters.batchId || "all"}`;

  return withShortStatsCache(cacheKey, async () => {
    let whereClause: Prisma.ClassWhereInput = {
      isActive: true,
      ...(filters.batchId ? { batchId: filters.batchId } : {}),
    };

    if (role === "TEACHER") {
      const tid =
        scope.teacherId ||
        (scope.userId
          ? (
              await prisma.teacher.findUnique({
                where: { userId: scope.userId },
                select: { id: true },
              })
            )?.id
          : undefined);
      const ids = tid ? await getTeacherAccessibleClassIds(tid) : [];
      if (ids.length === 0) {
        return { totalSections: 0, distinctClasses: 0, sectionsWithClassTeacher: 0 };
      }
      whereClause = { ...whereClause, id: { in: ids } };
    } else if (role === "PARENT") {
      const pid =
        scope.parentId ||
        (scope.userId
          ? (
              await prisma.parent.findUnique({
                where: { userId: scope.userId },
                select: { id: true },
              })
            )?.id
          : undefined);
      const childIds = pid ? await getParentStudentIds(pid) : [];
      if (childIds.length === 0) {
        return { totalSections: 0, distinctClasses: 0, sectionsWithClassTeacher: 0 };
      }
      whereClause = { ...whereClause, students: { some: { id: { in: childIds } } } };
    }

    const [totalSections, groupedNames, sectionsWithClassTeacher] = await prisma.$transaction([
      prisma.class.count({ where: whereClause }),
      prisma.class.groupBy({ by: ["name"], where: whereClause, orderBy: { name: "asc" } }),
      prisma.class.count({ where: { ...whereClause, classTeacherId: { not: null } } }),
    ]);

    return {
      totalSections,
      distinctClasses: groupedNames.length,
      sectionsWithClassTeacher,
    };
  });
}

/**
 * Single Source of Truth: Distinct active Subjects & Class Allocations.
 */
export async function getSubjectStats(
  scope: StatsScope = { role: "ADMIN" },
  filters: { classId?: string } = {}
): Promise<SubjectStatsSummary> {
  const role = String(scope.role || "").toUpperCase();
  const cacheKey = `subjects:${role}:${scope.userId || scope.teacherId || "all"}:${filters.classId || "all"}`;

  return withShortStatsCache(cacheKey, async () => {
    let whereClause: Prisma.SubjectWhereInput = {
      isActive: true,
      class: { isActive: true },
      ...(filters.classId && filters.classId !== "ALL" ? { classId: filters.classId } : {}),
    };

    if (role === "TEACHER") {
      const tid =
        scope.teacherId ||
        (scope.userId
          ? (
              await prisma.teacher.findUnique({
                where: { userId: scope.userId },
                select: { id: true },
              })
            )?.id
          : undefined);
      if (!tid) return { distinctSubjects: 0, totalAllocations: 0 };
      whereClause = { ...whereClause, teacherId: tid };
    }

    const [groupedNames, totalAllocations] = await prisma.$transaction([
      prisma.subject.groupBy({ by: ["name"], where: whereClause, orderBy: { name: "asc" } }),
      prisma.subject.count({ where: whereClause }),
    ]);

    return {
      distinctSubjects: groupedNames.length,
      totalAllocations,
    };
  });
}

/**
 * Combined dashboard summary returning all 5 top-level metrics from the single stats layer.
 */
export async function getAdminDashboardSummary(
  scope: StatsScope = { role: "ADMIN" }
): Promise<AdminDashboardSummary> {
  const cacheKey = `admin-dashboard-summary:${scope.role || "ADMIN"}:${scope.userId || "all"}`;
  return withShortStatsCache(
    cacheKey,
    async () => {
      const [students, teachers, parents, classes, subjects] = await Promise.all([
        getTotalStudents(scope),
        getTeacherStats(scope),
        getParentStats(scope),
        getClassCounts(scope),
        getSubjectStats(scope),
      ]);

      return { students, teachers, parents, classes, subjects };
    },
    20_000 // 20s short-lived stats cache prevents connection pool exhaustion and 5s query timeouts
  );
}

/**
 * Paginated Students list where `total` uses the exact same where-clause as `items`.
 */
export async function listStudentsPaginated(
  scope: StatsScope = { role: "ADMIN" },
  filters: CoreCountsFilters = {}
): Promise<PaginatedResult<any>> {
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.max(1, Math.min(500, Number(filters.pageSize) || 50));
  const where = await buildScopedStudentWhere(scope, filters);

  const [total, items] = await prisma.$transaction([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: pageSize,
      skip: (page - 1) * pageSize,
      select: {
        id: true,
        rollNumber: true,
        admissionNo: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        gender: true,
        bloodGroup: true,
        address: true,
        photo: true,
        isActive: true,
        batch: true,
        residenceType: true,
        enrollmentStatus: true,
        classId: true,
        class: { select: { id: true, name: true, section: true } },
        parents: {
          select: {
            parent: {
              select: {
                id: true,
                userId: true,
                phone: true,
                alternatePhone: true,
                occupation: true,
                isActive: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    googleEmail: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Paginated Teachers list where `total` uses the exact same where-clause as `items`.
 */
export async function listTeachersPaginated(
  scope: StatsScope = { role: "ADMIN" },
  filters: CoreCountsFilters = {}
): Promise<PaginatedResult<any>> {
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.max(1, Math.min(500, Number(filters.pageSize) || 50));
  const status = filters.status || "ACTIVE";

  const where: Prisma.TeacherWhereInput = {
    ...(status === "ACTIVE"
      ? { isActive: true, user: { status: "ACTIVE" } }
      : status === "INACTIVE"
      ? { OR: [{ isActive: false }, { user: { status: "INACTIVE" } }] }
      : {}),
    ...(String(scope.role || "").toUpperCase() === "TEACHER" && scope.userId
      ? { userId: scope.userId }
      : {}),
  };

  const [total, items] = await prisma.$transaction([
    prisma.teacher.count({ where }),
    prisma.teacher.findMany({
      where,
      orderBy: { user: { name: "asc" } },
      take: pageSize,
      skip: (page - 1) * pageSize,
      include: {
        user: true,
        classes: { where: { isActive: true } },
        subjects: { where: { isActive: true } },
        classTeacherOf: true,
      },
    }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Paginated Parents list where `total` matches Dashboard's canonical Parent count
 * and respects active student filters consistently.
 */
export async function listParentsPaginated(
  scope: StatsScope = { role: "ADMIN" },
  filters: CoreCountsFilters = {}
): Promise<PaginatedResult<any>> {
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.max(1, Math.min(500, Number(filters.pageSize) || 50));

  const status = filters.status || "ALL";
  const where: Prisma.ParentWhereInput = {
    ...(status === "ACTIVE"
      ? {
          isActive: true,
          user: { status: "ACTIVE" },
          children: { some: { student: getActiveStudentWhere() } },
        }
      : status === "INACTIVE"
      ? { OR: [{ isActive: false }, { user: { status: "INACTIVE" } }] }
      : {}),
    ...(filters.classId && filters.classId !== "ALL"
      ? { children: { some: { student: getActiveStudentWhere({ classId: filters.classId }) } } }
      : {}),
    ...(filters.search?.trim()
      ? {
          OR: [
            { phone: { contains: filters.search.trim(), mode: "insensitive" } },
            { user: { name: { contains: filters.search.trim(), mode: "insensitive" } } },
            { user: { email: { contains: filters.search.trim(), mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(String(scope.role || "").toUpperCase() === "PARENT" && scope.userId
      ? { userId: scope.userId }
      : {}),
  };

  const [total, items] = await prisma.$transaction([
    prisma.parent.count({ where }),
    prisma.parent.findMany({
      where,
      orderBy: { user: { name: "asc" } },
      take: pageSize,
      skip: (page - 1) * pageSize,
      include: {
        user: true,
        children: {
          where: { student: getActiveStudentWhere() },
          include: {
            student: { include: { class: true } },
          },
        },
      },
    }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
