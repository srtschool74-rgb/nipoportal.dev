"use server";

import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { revalidatePath } from "next/cache";
import {
  fixDataCheckIssue,
  runDataReconciliationCheck,
} from "@/backend/services/stats";
import { DataCheckIssue } from "@/backend/services/stats/types";

export async function runDataCheckAction() {
  const session = await getServerSession(getAuthOptions());
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const report = await runDataReconciliationCheck();
    return { success: true, report };
  } catch (err) {
    console.error("runDataCheckAction error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to run data check",
    };
  }
}

export async function fixDataCheckIssueAction(
  category: DataCheckIssue["category"],
  recordId: string
) {
  const session = await getServerSession(getAuthOptions());
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const result = await fixDataCheckIssue(category, recordId);
    revalidatePath("/dashboard/admin/data-check");
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard/admin/parents");
    revalidatePath("/dashboard/admin/students");
    revalidatePath("/dashboard/admin/teachers");
    revalidatePath("/dashboard/admin/classes");
    revalidatePath("/dashboard/admin/classes/reconciliation");
    revalidatePath("/admin/buses");
    const report = await runDataReconciliationCheck();
    return { success: true, message: result.message, report };
  } catch (err) {
    console.error("fixDataCheckIssueAction error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to auto-fix issue",
    };
  }
}
