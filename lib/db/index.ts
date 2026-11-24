import { PrismaClient } from "@prisma/client";

const globalForDb = globalThis as unknown as {
  primaryPrisma?: PrismaClient;
  secondaryPrisma?: PrismaClient;
};

/**
 * Sanitizes and optimizes database URLs for serverless environments (e.g. Vercel).
 * Enforces a small connection limit (2) to prevent exhausting Supabase's session pooler limit (15).
 */
export function sanitizeConnectionUrl(rawUrl: string): string {
  let url = rawUrl;
  if (url.includes("connection_limit=")) {
    url = url.replace(/connection_limit=\d+/, "connection_limit=2");
  } else {
    url += (url.includes("?") ? "&" : "?") + "connection_limit=2";
  }
  if (!url.includes("connect_timeout=")) {
    url += "&connect_timeout=15";
  }
  return url;
}

/**
 * Lazily creates or returns the singleton Primary Prisma Client (Neon Singapore).
 * Never called at module evaluation time.
 */
export function getPrimaryClient(): PrismaClient {
  if (globalForDb.primaryPrisma) {
    return globalForDb.primaryPrisma;
  }

  const rawUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL;
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Please define DATABASE_URL in your environment variables."
    );
  }

  const url = sanitizeConnectionUrl(rawUrl);

  const client = new PrismaClient({
    datasources: {
      db: { url },
    },
    log:
      process.env.NODE_ENV === "development" && process.env.DEBUG_QUERIES === "true"
        ? ["query", "error", "warn"]
        : ["error", "warn"],
  });

  globalForDb.primaryPrisma = client;
  return client;
}

/**
 * Lazily creates or returns the singleton Secondary Prisma Client (Supabase Ireland).
 * Never called at module evaluation time.
 */
export function getSecondaryClient(): PrismaClient | null {
  if (globalForDb.secondaryPrisma) {
    return globalForDb.secondaryPrisma;
  }

  const rawSupaUrl =
    process.env.SECONDARY_DATABASE_URL ||
    process.env.SUPABASE_DATABASE_URL ||
    process.env.SUPABASE_DIRECT_URL;

  if (!rawSupaUrl) {
    return null;
  }

  const supaUrl = sanitizeConnectionUrl(rawSupaUrl);

  const client = new PrismaClient({
    datasources: {
      db: { url: supaUrl },
    },
    log: ["error", "warn"],
  });

  globalForDb.secondaryPrisma = client;
  return client;
}

export function isPrimaryDbConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL
  );
}

export function isSecondaryDbConfigured(): boolean {
  return Boolean(
    process.env.SECONDARY_DATABASE_URL ||
    process.env.SUPABASE_DATABASE_URL ||
    process.env.SUPABASE_DIRECT_URL
  );
}

/**
 * Lazy Primary DB proxy singleton.
 * Importing this never throws and never connects to the database.
 * Initialization happens strictly on first query at runtime.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    // Avoid intercepting promise resolution or React symbol checks
    if (prop === "then" || prop === "$$typeof" || prop === Symbol.toStringTag) {
      return undefined;
    }
    const client = getPrimaryClient();
    const value = Reflect.get(client, prop, client);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

/**
 * Lazy Secondary DB proxy singleton.
 * Throws only when a query is executed if SECONDARY_DATABASE_URL is missing.
 */
export const dbSecondary: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (prop === "then" || prop === "$$typeof" || prop === Symbol.toStringTag) {
      return undefined;
    }
    const client = getSecondaryClient();
    if (!client) {
      throw new Error(
        "SECONDARY_DATABASE_URL is not configured. Please define SECONDARY_DATABASE_URL in your environment variables."
      );
    }
    const value = Reflect.get(client, prop, client);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

// Re-export standard prisma reference for backward compatibility
export const prisma = db;
export default db;
