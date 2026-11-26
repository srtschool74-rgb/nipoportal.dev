"use server";

import { prisma } from "@/backend/db/prisma";

/**
 * Resolves the role for a given user login identifier (email, phone, or alternate email)
 * so the frontend can route directly to /dashboard/<role> with ZERO intermediate redirects.
 */
export async function resolveUserRoleAction(identifier: string): Promise<string | null> {
  if (!identifier || typeof identifier !== "string") return null;
  const clean = identifier.trim();
  if (!clean) return null;

  const lower = clean.toLowerCase();
  const digitsOnly = clean.replace(/[^0-9]/g, "");

  try {
    const searchConditions: any[] = [
      { email: { equals: lower, mode: "insensitive" } },
      { email: { equals: clean, mode: "insensitive" } },
      { alternateEmail: { equals: lower, mode: "insensitive" } },
      { alternateEmail: { equals: clean, mode: "insensitive" } },
      { googleEmail: { equals: lower, mode: "insensitive" } },
      { googleEmail: { equals: clean, mode: "insensitive" } },
    ];

    if (digitsOnly.length === 10) {
      searchConditions.push(
        { teacher: { phone: digitsOnly } },
        { parent: { phone: digitsOnly } }
      );
    }

    const user = await prisma.user.findFirst({
      where: { OR: searchConditions },
      select: { role: true },
    });

    return user?.role || null;
  } catch (err) {
    console.warn("[resolveUserRoleAction] Error:", err);
    return null;
  }
}
