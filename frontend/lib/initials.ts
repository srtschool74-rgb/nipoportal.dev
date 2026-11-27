/**
 * Extracts uppercase initials from a user's full name:
 * - Two or more words ("First Last", "First Middle Last"): first letter of first name + first letter of last name.
 * - Single word: up to the first two letters uppercase.
 * - Empty or missing: returns fallback (default "U").
 */
export function getUserInitials(name?: string | null, fallback = "U"): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return fallback;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  return parts[0].slice(0, 2).toUpperCase();
}
