"use client";

import Link from "next/link";
import { Users, GraduationCap, BookOpen, Briefcase, UserCheck, ShieldCheck } from "lucide-react";
import type { AdminDashboardSummary } from "@/backend/services/stats/types";
import { useStatsLiveRefresh } from "@/frontend/hooks/useStatsLiveRefresh";
import DashboardSectionSkeleton from "@/frontend/components/ui/DashboardSectionSkeleton";
import styles from "@/frontend/app/dashboard/dashboard.module.css";

interface AdminDashboardStatsGridProps {
  initialSummary: AdminDashboardSummary;
}

export default function AdminDashboardStatsGrid({
  initialSummary,
}: AdminDashboardStatsGridProps) {
  const { summary, isLoading } = useStatsLiveRefresh(initialSummary);

  if (isLoading && !summary) {
    return <DashboardSectionSkeleton title="Loading dashboard metrics" variant="cards" count={7} />;
  }

  const stats = summary ?? initialSummary;

  return (
    <div className={styles.statsGrid}>
      <Link href="/dashboard/admin/students" prefetch={false} style={{ textDecoration: "none", color: "inherit" }}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: "var(--primary-bg)", color: "var(--primary)" }}>
            <Users size={24} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Total Students</span>
            <span className={styles.statValue}>{stats.students.activeStudents}</span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
              Active enrolled{stats.students.inactiveOrGraduatedStudents > 0 ? ` · ${stats.students.allStudentsIncludingInactive} total` : ""}
            </span>
          </div>
        </div>
      </Link>

      <Link href="/dashboard/admin/teachers" prefetch={false} style={{ textDecoration: "none", color: "inherit" }}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: "var(--success-bg)", color: "var(--success)" }}>
            <Briefcase size={24} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Total Teachers</span>
            <span className={styles.statValue}>{stats.teachers.activeTeachers}</span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>Active faculty accounts</span>
          </div>
        </div>
      </Link>

      <Link href="/dashboard/admin/parents" prefetch={false} style={{ textDecoration: "none", color: "inherit" }}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: "var(--warning-bg)", color: "var(--warning)" }}>
            <Users size={24} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Total Parents</span>
            <span className={styles.statValue}>{stats.parents.totalParents}</span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
              {stats.parents.activeParents} active with linked student
            </span>
          </div>
        </div>
      </Link>

      <Link href="/dashboard/admin/classes" prefetch={false} style={{ textDecoration: "none", color: "inherit" }}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: "rgba(139, 92, 246, 0.1)", color: "#8b5cf6" }}>
            <GraduationCap size={24} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Total Classes</span>
            <span className={styles.statValue}>{stats.classes.totalSections}</span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
              {stats.classes.distinctClasses} levels · {stats.classes.totalSections} class-sections
            </span>
          </div>
        </div>
      </Link>

      <Link href="/dashboard/admin/subjects" prefetch={false} style={{ textDecoration: "none", color: "inherit" }}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: "rgba(236, 72, 153, 0.1)", color: "#ec4899" }}>
            <BookOpen size={24} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Total Subjects</span>
            <span className={styles.statValue}>{stats.subjects.distinctSubjects}</span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
              {stats.subjects.distinctSubjects} distinct · {stats.subjects.totalAllocations} allocations
            </span>
          </div>
        </div>
      </Link>

      <Link href="/dashboard/admin/teacher-attendance" prefetch={false} style={{ textDecoration: "none", color: "inherit" }}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: "var(--success-bg)", color: "var(--success)" }}>
            <UserCheck size={24} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Teacher Attendance</span>
            <span className={styles.statValue}>Manage</span>
          </div>
        </div>
      </Link>

      <Link href="/dashboard/admin/staff-attendance" prefetch={false} style={{ textDecoration: "none", color: "inherit" }}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: "rgba(6, 182, 212, 0.1)", color: "#06b6d4" }}>
            <UserCheck size={24} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Staff Attendance</span>
            <span className={styles.statValue}>Manage</span>
          </div>
        </div>
      </Link>

      <Link href="/dashboard/admin/data-check" prefetch={false} style={{ textDecoration: "none", color: "inherit" }}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ backgroundColor: "rgba(16, 185, 129, 0.1)", color: "#10b981" }}>
            <ShieldCheck size={24} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Data Integrity</span>
            <span className={styles.statValue}>Check</span>
          </div>
        </div>
      </Link>
    </div>
  );
}
