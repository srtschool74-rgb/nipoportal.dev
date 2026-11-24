import { cache } from "react";
import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";

/**
 * Request-scoped memoized session getter using React 19's cache().
 * Prevents redundant JWT decoding / session verification during a single server render
 * (e.g., Root Layout -> Dashboard Layout -> Child Page).
 */
export const getCachedServerSession = cache(async () => {
  try {
    if (!process.env.NEXTAUTH_SECRET && !process.env.SUPABASE_JWT_SECRET) {
      return null;
    }
    return await getServerSession(getAuthOptions());
  } catch (err) {
    console.warn("[SessionCache] Warning fetching session:", err);
    return null;
  }
});

