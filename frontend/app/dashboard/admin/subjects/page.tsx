import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { prisma } from "@/backend/db/prisma";
import { getSubjectStats } from "@/backend/services/stats";
import styles from "../../dashboard.module.css";
import SubjectListClient from "./SubjectListClient";

export const dynamic = "force-dynamic";

export default async function AdminSubjectsPage() {
  const session = await getServerSession(getAuthOptions());
  if (!session || session.user.role !== 'ADMIN') return null;

  // Fetch all subjects with their class, teacher, and marks
  const [subjects, classes, teachers, subjectStats] = await Promise.all([
    prisma.subject.findMany({
      where: { isActive: true, class: { isActive: true } },
      include: {
        class: {
          include: { students: { where: { isActive: true } } }
        },
        teacher: {
          include: { user: true }
        },
        marks: true
      }
    }),
    prisma.class.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }, { section: 'asc' }]
    }),
    prisma.teacher.findMany({
      where: { isActive: true },
      include: { user: true },
      orderBy: { user: { name: 'asc' } }
    }),
    getSubjectStats({ role: "ADMIN" }),
  ]);

  return (
    <div className={styles.dashboard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.5rem' }}>
        <h1 className={styles.title} style={{ margin: 0 }}>Subjects</h1>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, padding: '0.35rem 0.75rem', borderRadius: '999px', background: 'rgba(236, 72, 153, 0.12)', color: '#ec4899' }}>
            {subjectStats.distinctSubjects} Distinct Subjects
          </span>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, padding: '0.35rem 0.75rem', borderRadius: '999px', background: 'rgba(148, 163, 184, 0.12)', color: 'var(--text-secondary)' }}>
            {subjectStats.totalAllocations} Class Allocations
          </span>
        </div>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Overview of all active subjects across all active classes.</p>

      <SubjectListClient subjects={subjects} classes={classes} teachers={teachers} />
    </div>
  );
}
