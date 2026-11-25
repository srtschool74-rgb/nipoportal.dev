import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { runDataReconciliationCheck } from "@/backend/services/stats";
import styles from "../../dashboard.module.css";
import DataCheckClient from "./DataCheckClient";

export const dynamic = "force-dynamic";

export default async function AdminDataCheckPage() {
  const session = await getServerSession(getAuthOptions());
  if (!session || session.user?.role !== "ADMIN") {
    redirect("/login");
  }

  const report = await runDataReconciliationCheck();

  return (
    <div className={styles.dashboard}>
      <DataCheckClient initialReport={report} />
    </div>
  );
}

