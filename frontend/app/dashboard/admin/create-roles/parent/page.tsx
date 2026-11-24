export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { prisma } from "@/backend/db/prisma";
import ParentStudentWizard from "./ParentStudentWizard";

export default async function CreateParentPage() {
  let classes: any[] = [];
  try {
    if (process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL) {
      classes = await prisma.class.findMany({
        where: { isActive: true },
        select: { id: true, name: true, section: true },
        orderBy: [{ name: 'asc' }, { section: 'asc' }]
      });
    }
  } catch (err) {
    console.warn("[CreateParentPage] Note loading classes:", err);
  }

  return <ParentStudentWizard classes={classes} />;
}
