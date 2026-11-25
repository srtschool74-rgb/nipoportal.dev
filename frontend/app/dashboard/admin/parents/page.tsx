import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { prisma } from "@/backend/db/prisma";
import { getParentStats, listParentsPaginated } from "@/backend/services/stats";
import styles from "../../dashboard.module.css";
import ParentListClient from "./ParentListClient";

export const dynamic = "force-dynamic";

export default async function AdminParentsPage() {
  const session = await getServerSession(getAuthOptions());
  if (!session || session.user.role !== 'ADMIN') return null;

  const [parentsPage, classes, parentStats] = await Promise.all([
    listParentsPaginated({ role: "ADMIN" }, { status: "ALL", page: 1, pageSize: 500 }),
    prisma.class.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }, { section: 'asc' }]
    }),
    getParentStats({ role: "ADMIN" }),
  ]);

  return (
    <div className={styles.dashboard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 className={styles.title} style={{ margin: 0 }}>Parents</h1>
        <p style={{ color: 'var(--text-secondary)' }}>To create new parents, please use the &quot;Create New Roles&quot; section in the sidebar.</p>
      </div>

      <ParentListClient
        parents={parentsPage.items}
        classes={classes}
        totalStudentsCount={parentStats.totalStudentsCount}
        parentStats={parentStats}
      />
    </div>
  );
}
