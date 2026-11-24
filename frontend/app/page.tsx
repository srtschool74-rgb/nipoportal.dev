import HomeClient from "./HomeClient";
import { getSystemSettings } from "@/backend/api/actions/dashboard/admin/settings/actions";

interface HomeProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function Home(props: HomeProps) {
  let searchParams: { error?: string } = {};
  try {
    searchParams = (await props?.searchParams) || {};
  } catch {}

  let schoolName = "SRT UNIVERSAL SCHOOL";
  let schoolLogo = "/logo/srt-logo.svg";
  try {
    const settings = await Promise.race([
      getSystemSettings(),
      new Promise<Record<string, string>>((resolve) => setTimeout(() => resolve({}), 80)),
    ]);
    if (settings.SCHOOL_NAME) schoolName = settings.SCHOOL_NAME;
    if (settings.SCHOOL_LOGO) schoolLogo = settings.SCHOOL_LOGO;
  } catch {}

  // Home animation plays cleanly on every open and logout
  return (
    <HomeClient
      schoolName={schoolName}
      schoolLogo={schoolLogo}
      initialError={searchParams.error}
      authenticatedRole={null}
    />
  );
}
