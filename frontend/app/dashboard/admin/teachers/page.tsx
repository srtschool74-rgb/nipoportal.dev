import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { redirect } from "next/navigation";
import { prisma } from "@/backend/db/prisma";
import { getTeacherStats } from "@/backend/services/stats";
import styles from "../../dashboard.module.css";
import TeacherListClient from "./TeacherListClient";
import SettingsNavSwitcher from "@/frontend/components/admin/SettingsNavSwitcher";

export const dynamic = "force-dynamic";

export default async function AdminTeachersPage() {
  const session = await getServerSession(getAuthOptions());
  if (!session || session.user?.role !== 'ADMIN') redirect("/login");

  const [teachers, allClasses, allSubjects, teacherStats] = await Promise.all([
    prisma.teacher.findMany({
      orderBy: { user: { name: 'asc' } },
      include: {
        user: true,
        classes: { where: { isActive: true } },
        subjects: { where: { isActive: true } },
        classTeacherOf: true
      }
    }),
    prisma.class.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }, { section: 'asc' }]
    }),
    prisma.subject.findMany({
      where: { isActive: true },
      distinct: ['name'],
      orderBy: { name: 'asc' }
    }),
    getTeacherStats({ role: "ADMIN" }),
  ]);

  return (
    <div className={styles.dashboard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
        <h1 className={styles.title} style={{ margin: 0 }}>Teacher Management</h1>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, padding: '0.35rem 0.75rem', borderRadius: '999px', background: 'rgba(16, 185, 129, 0.12)', color: 'var(--success)' }}>
            Active Faculty: {teacherStats.activeTeachers}
          </span>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, padding: '0.35rem 0.75rem', borderRadius: '999px', background: 'rgba(148, 163, 184, 0.12)', color: 'var(--text-secondary)' }}>
            All incl. Inactive: {teacherStats.allTeachersIncludingInactive}
          </span>
        </div>
      </div>

      {/* Switcher Option between Settings, Teacher Management, and Parent & Student */}
      <SettingsNavSwitcher />

      <TeacherListClient teachers={teachers} allClasses={allClasses} allSubjects={allSubjects} teacherStats={teacherStats} />
    </div>
  );
}
