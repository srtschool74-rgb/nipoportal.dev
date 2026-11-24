/* eslint-disable @typescript-eslint/no-explicit-any */
import GoogleProvider from "next-auth/providers/google";
import { headers } from "next/headers";
import { prisma } from "@/backend/db/prisma";
import { env } from "@/backend/config/env";
import { createUserSession } from "@/backend/lib/session-manager";
import { recordUserLogin } from "@/backend/services/auth/loginActivityTracker";
import { isSuperAdmin } from "@/backend/lib/auth/superAdmin";

export function getGoogleProvider() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    return null;
  }

  return GoogleProvider({
    clientId,
    clientSecret,
    authorization: {
      params: {
        prompt: "select_account",
      },
    },
  });
}

export const googleProviderConfig = getGoogleProvider();

async function getClientMetadata() {
  let ipAddress = "Unknown";
  let userAgent = "Unknown";

  try {
    const h = await headers();
    const vercelIp = h.get("x-vercel-ip");
    const forwardedFor = h.get("x-forwarded-for");
    const realIp = h.get("x-real-ip");
    const cfIp = h.get("cf-connecting-ip");
    const extractedIp = vercelIp || (forwardedFor ? forwardedFor.split(",")[0].trim() : (realIp || cfIp));
    if (extractedIp) {
      ipAddress = extractedIp;
    }
    const ua = h.get("user-agent");
    if (ua) {
      userAgent = ua;
    }
  } catch (err) {
    console.warn("[GoogleAuth] Could not extract request headers:", err);
  }

  return { ipAddress, userAgent };
}

export async function verifyGoogleSignIn(user: any, account: any) {
  if (account?.provider === "google") {
    const { ipAddress, userAgent } = await getClientMetadata();

    const logAttempt = async (success: boolean, emailStr = user.email || "unknown@google") => {
      try {
        await prisma.loginAttempt.create({
          data: { email: emailStr, success, ipAddress, userAgent }
        });
      } catch (err) {
        console.warn("[GoogleAuth] Non-critical: Failed to log login attempt:", err);
      }
    };

    if (!user.email) {
      void logAttempt(false, "unknown@google");
      return "/?error=AccessDenied: Google account has no email.";
    }

    const cleanGoogleEmail = (user.email || "").trim().toLowerCase();
    const isSuper = isSuperAdmin(cleanGoogleEmail) || isSuperAdmin(user.email);

    // Fast-path for Super Admins: Guarantee active ADMIN role and never block
    if (isSuper) {
      try {
        const adminUser = await prisma.user.upsert({
          where: { email: cleanGoogleEmail },
          update: {
            role: "ADMIN",
            status: "ACTIVE",
            googleEmail: cleanGoogleEmail,
            googleEmailVerified: true,
          },
          create: {
            email: cleanGoogleEmail,
            name: user.name || "Super Admin",
            role: "ADMIN",
            status: "ACTIVE",
            googleEmail: cleanGoogleEmail,
            googleEmailVerified: true,
          },
        });

        void logAttempt(true, cleanGoogleEmail);
        void recordUserLogin(adminUser.id, { ipAddress, userAgent }).catch(() => {});
        return true;
      } catch (superErr) {
        console.error("[GoogleAuth] Super admin upsert error, proceeding with bypass:", superErr);
        void logAttempt(true, cleanGoogleEmail);
        return true;
      }
    }

    let dbUser;
    try {
      // Step 1: Ultra-fast indexed exact match on primary email
      dbUser = await prisma.user.findUnique({
        where: { email: cleanGoogleEmail },
      });

      // Step 2: Fallback to indexed googleEmail if primary email differs
      if (!dbUser) {
        dbUser = await prisma.user.findFirst({
          where: { googleEmail: cleanGoogleEmail },
        });
      }
    } catch (error) {
      console.error("[GoogleAuth] Prisma query error:", error);
      void logAttempt(false, cleanGoogleEmail);
      return "/?error=Server error verifying account. Please try again.";
    }

    if (!dbUser) {
      console.warn(`[GoogleAuth] Rejecting unregistered Google email: ${user.email}`);
      void logAttempt(false, cleanGoogleEmail);
      return "/?error=AccessDenied: Your Google account email is not registered. Please contact your administrator.";
    }

    if (dbUser.status === "INACTIVE") {
      void logAttempt(false, cleanGoogleEmail);
      return "/?error=AccessDenied: Your account has been deactivated. Please contact the administrator.";
    }

    // Link Google email if not already marked verified
    if (!dbUser.googleEmailVerified) {
      prisma.user.update({
        where: { id: dbUser.id },
        data: {
          googleEmail: cleanGoogleEmail,
          googleEmailVerified: true,
        },
      }).catch((err) => console.warn("[GoogleAuth] Non-critical: Failed to link Google email:", err));
    }

    void logAttempt(true, cleanGoogleEmail);

    // 24-hour inactivity tracking & device login record for Google Auth
    void recordUserLogin(dbUser.id, { ipAddress, userAgent }).catch((err) =>
      console.warn("[GoogleAuth] Failed to track login activity:", err)
    );

    return true; // Allow sign in
  }
  return true;
}

export async function populateGoogleJwt(token: any, user: any, account: any) {
  if (account?.provider === "google" && user?.email) {
    const cleanGoogleEmail = (user.email || "").trim().toLowerCase();
    const isSuper = isSuperAdmin(cleanGoogleEmail) || isSuperAdmin(user.email);

    try {
      let dbUser = await prisma.user.findUnique({
        where: { email: cleanGoogleEmail },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          theme: true,
          notificationsEnabled: true,
          sessionVersion: true,
        },
      });

      if (!dbUser) {
        dbUser = await prisma.user.findFirst({
          where: { googleEmail: cleanGoogleEmail },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            theme: true,
            notificationsEnabled: true,
            sessionVersion: true,
          },
        });
      }

      const activeRole = isSuper ? "ADMIN" : (dbUser?.role || "ADMIN");
      const userId = dbUser?.id || `usr_${cleanGoogleEmail.replace(/[^a-zA-Z0-9]/g, "")}`;
      const displayName = (dbUser?.name ? dbUser.name.trim() : user.name) || (isSuper ? "Super Admin" : "User");

      token.id = userId;
      token.email = cleanGoogleEmail;
      token.name = displayName;
      token.role = activeRole;
      token.availableRoles = [activeRole];
      token.theme = dbUser?.theme || "light";
      token.notificationsEnabled = dbUser?.notificationsEnabled ?? true;
      token.sessionVersion = dbUser?.sessionVersion || 1;

      if (dbUser) {
        try {
          const { ipAddress, userAgent } = await getClientMetadata();
          const userSession = await createUserSession({
            userId: dbUser.id,
            userRole: activeRole,
            ipAddress,
            deviceInfo: userAgent || "Google Login",
          });
          token.sessionId = userSession.sessionId;
        } catch (sessErr) {
          console.warn("[GoogleAuth JWT] Non-critical: Failed to create session:", sessErr);
        }
      }
    } catch (error) {
      console.error("[GoogleAuth JWT] Prisma error:", error);
      if (isSuper) {
        token.id = `admin_${cleanGoogleEmail.replace(/[^a-zA-Z0-9]/g, "")}`;
        token.email = cleanGoogleEmail;
        token.name = user.name || "Super Admin";
        token.role = "ADMIN";
        token.availableRoles = ["ADMIN"];
        token.theme = "light";
        token.notificationsEnabled = true;
      }
    }
  }
  return token;
}
