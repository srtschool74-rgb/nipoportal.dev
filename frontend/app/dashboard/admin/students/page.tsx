import { getCachedServerSession } from "@/backend/auth/sessionCache";
import { redirect } from "next/navigation";
import { prisma } from "@/backend/db/prisma";
import { getTotalStudents, listStudentsPaginated } from "@/backend/services/stats";
import styles from "../../dashboard.module.css";
import StudentListClient from "./StudentListClient";
import SettingsNavSwitcher from "@/frontend/components/admin/SettingsNavSwitcher";

export const dynamic = "force-dynamic";

export default async function AdminStudentsPage() {
  const session = await getCachedServerSession();
  if (!session || session.user?.role !== 'ADMIN') redirect("/login");

  const [studentsPage, classes, studentStats] = await Promise.all([
    listStudentsPaginated({ role: "ADMIN" }, { status: "ALL", page: 1, pageSize: 500 }),
    prisma.class.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }, { section: 'asc' }],
      include: {
        classTeacher: {
          include: {
            user: {
              select: { name: true }
            }
          }
        }
      }
    }),
    getTotalStudents({ role: "ADMIN" }),
  ]);

  return (
    <div className={styles.dashboard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
        <h1 className={styles.title} style={{ margin: 0 }}>Parent &amp; Student Management</h1>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, padding: '0.35rem 0.75rem', borderRadius: '999px', background: 'rgba(59, 130, 246, 0.12)', color: 'var(--primary)' }}>
            Active Students: {studentStats.activeStudents}
          </span>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, padding: '0.35rem 0.75rem', borderRadius: '999px', background: 'rgba(16, 185, 129, 0.12)', color: 'var(--success)' }}>
            Day Scholars: {studentStats.dayScholars} · Hostelers: {studentStats.hostelers}
          </span>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, padding: '0.35rem 0.75rem', borderRadius: '999px', background: 'rgba(148, 163, 184, 0.12)', color: 'var(--text-secondary)' }}>
            All incl. Inactive: {studentStats.allStudentsIncludingInactive}
          </span>
        </div>
      </div>

      {/* Switcher Option between Settings, Teacher Management, and Parent & Student */}
      <SettingsNavSwitcher />

      <StudentListClient
        students={studentsPage.items as any}
        classes={classes as any}
        studentStats={studentStats}
      />
    </div>
  );
}
