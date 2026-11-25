import fs from "fs";
import path from "path";

/**
 * Loads `.env.local` (or `.env` fallback) into `process.env` when executed in CLI/test scripts
 * outside Next.js without requiring an external `dotenv` package.
 */
export function loadLocalEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
  ];
  const loader = (process as unknown as { loadEnvFile?: (filePath: string) => void }).loadEnvFile;
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      loader?.(filePath);
      break;
    } catch {
      // Ignore already-set env vars or unreadable optional env files
    }
  }
}

loadLocalEnv();
