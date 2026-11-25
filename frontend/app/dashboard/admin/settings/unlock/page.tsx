import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { redirect } from "next/navigation";
import { isSettingsUnlockedServer, getOrCreateSettingsSecurity } from "@/backend/lib/settings/settingsSecurityConfig";
import { getSchoolInfo } from "@/backend/api/actions/dashboard/admin/settings/actions";
import SettingsUnlockGateClient from "@/frontend/components/settings/SettingsUnlockGateClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Unlock Settings | School Portal",
  description: "Enter your settings password to access administrative configurations.",
};

export default async function AdminSettingsUnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ returnUrl?: string }>;
}) {
  const session = await getServerSession(getAuthOptions());
  if (!session || session.user?.role !== "ADMIN") {
    redirect("/login");
  }

  const resolvedParams = await searchParams;
  const returnUrl = resolvedParams?.returnUrl || "/dashboard/admin/settings";

  // Check if already unlocked
  try {
    const unlockStatus = await isSettingsUnlockedServer();
    if (unlockStatus.unlocked) {
      redirect(returnUrl);
    }
  } catch (err: any) {
    if (err?.digest?.startsWith?.("NEXT_") || err?.digest === "DYNAMIC_SERVER_USAGE") {
      throw err;
    }
  }

  let security: any = null;
  try {
    security = await getOrCreateSettingsSecurity();
  } catch (err) {
    console.error("[SettingsUnlockPage] Failed to get settings security:", err);
  }

  let schoolInfo: Record<string, string> = {};
  try {
    schoolInfo = await getSchoolInfo(true);
  } catch (err) {
    console.error("[SettingsUnlockPage] Failed to get school info:", err);
  }

  let remainingMinutes: number | undefined;
  let initialLockedUntil: string | null = null;

  if (security?.lockedUntil) {
    const lockTime = new Date(security.lockedUntil).getTime();
    if (!isNaN(lockTime) && lockTime > Date.now()) {
      remainingMinutes = Math.max(1, Math.ceil((lockTime - Date.now()) / (60 * 1000)));
      initialLockedUntil = new Date(lockTime).toISOString();
    }
  }

  return (
    <SettingsUnlockGateClient
      initialLockedUntil={initialLockedUntil}
      initialRemainingMinutes={remainingMinutes}
      returnUrl={returnUrl}
      schoolName={schoolInfo.SCHOOL_NAME || "SRT Universal School"}
      logoUrl={schoolInfo.SCHOOL_LOGO || "/logo.png"}
    />
  );
}
