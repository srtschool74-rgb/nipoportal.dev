import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedAdminClient: SupabaseClient | null = null;

/**
 * Returns a shared, module-level Supabase server client using the service role key.
 * Throws a clear, readable error if required environment variables are missing.
 * Never import this module from client components.
 */
export function getSupabaseServerClient(): SupabaseClient {
  if (cachedAdminClient) {
    return cachedAdminClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "[SupabaseServer] Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) environment variable."
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      "[SupabaseServer] Missing SUPABASE_SERVICE_ROLE_KEY environment variable."
    );
  }

  cachedAdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedAdminClient;
}
