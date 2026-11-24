export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { prisma } from "@/backend/db/prisma";
import CreateTeacherClient from "./CreateTeacherClient";

export default async function AdminCreateTeacherPage() {
  const session = await getServerSession(getAuthOptions());
  if (!session || session.user.role !== 'ADMIN') return null;

  let subjects: any[] = [];
  let allSchoolSubjects: any[] = [];
  let classes: any[] = [];

  try {
    if (process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL) {
      [subjects, allSchoolSubjects, classes] = await Promise.all([
        prisma.subject.findMany({
          where: { isActive: true, teacherId: null },
          include: { class: true },
          orderBy: [{ class: { name: 'asc' } }, { class: { section: 'asc' } }, { name: 'asc' }]
        }),
        prisma.subject.findMany({
          where: { isActive: true },
          select: { name: true, code: true },
          distinct: ['name'],
          orderBy: { name: 'asc' }
        }),
        prisma.class.findMany({
          where: { isActive: true },
          orderBy: [{ name: 'asc' }, { section: 'asc' }]
        })
      ]);
    }
  } catch (err) {
    console.warn("[AdminCreateTeacherPage] Note loading subjects/classes:", err);
  }

  return <CreateTeacherClient subjects={subjects} classes={classes} allSchoolSubjects={allSchoolSubjects} />;
}
