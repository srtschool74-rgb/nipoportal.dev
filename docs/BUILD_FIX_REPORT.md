# Build Fix and Security Audit Report

## 1. Executive Summary

This report documents the resolution of two production deployment failures (Vercel and Render) and an audit and remediation of npm dependencies.

1. **Vercel Build Failure**: Resolved the server-only boundary leakage where `next/headers` was pulled into a client component bundle via `AdminBusManagement.tsx` importing from backend stats modules.
2. **Render Build Failure**: Resolved the `vitest.config.ts(1,30): error TS2307: Cannot find module 'vitest/config'` error by cleanly isolating dev-only test tooling from the production TypeScript configuration and setting up Render build configuration.
3. **Database & Excel Import Verification**: Resolved `EMAXCONNSESSION` database pooling root cause and confirmed that `parent & student details.xlsx` scans cleanly with all 7 rows marked valid and ready to import (`readyToImportCount: 7`).
4. **Stats Unification Proof**: Verified that Admin Dashboard and Parents Directory metrics agree completely, showing 0 parents when the database contains 0 parent accounts.
5. **Security Audit**: Executed `npm audit` and applied non-breaking fixes with `npm audit fix`, reducing vulnerabilities from 22 down to 11.

---

## 2. Failure 1: Vercel (`next/headers` in Client Component)

### Root Cause
`frontend/components/transport/AdminBusManagement.tsx` is marked with `"use client"`. It previously imported helper functions directly from `backend/services/stats/transport.ts`.
That module imported from `backend/services/stats/cache.ts`, which imported `parentChildHelper.ts` from inside `frontend/app/dashboard/parent/`.
`parentChildHelper.ts` utilized `cookies()` from `next/headers` and direct Prisma client queries.
Next.js webpack App Router bundler identified `next/headers` inside a client chunk, failing the build with:
```
Error: You're importing a module that depends on "next/headers".
This API is only available in Server Components in the App Router...
 4 | import { cookies } from "next/headers";
```

### Remediation Applied
1. **Isolated Pure Types & Helpers**:
   - Created `shared/types/transport.ts` containing pure transport interfaces (`BusFleetSummary`, `TransportSummaryMetrics`), constants (`RESIDENCE_TYPE_DAYSCHOLAR`, `RESIDENCE_TYPE_HOSTEL`), and pure functions `computeBusSeatMetrics` and `isDayScholarStudent`. No server or database dependencies.
   - Created `shared/types/academics.ts` containing pure grading and formatting helpers (`getUnifiedReportCardGrade`, `roundOneDecimal`, `formatOneDecimal`, `normalizeExamResultLabel`).
   - Created `shared/types/stats.ts` containing shared summary interfaces (`AdminDashboardSummary`, `StudentStatsSummary`, `TeacherStatsSummary`, `ParentStatsSummary`, `ClassStatsSummary`, `SubjectStatsSummary`, `ReconciliationSummaryReport`, etc.).
2. **Layering Correction**:
   - Relocated server-only helpers out of frontend app routes into backend services:
     - `backend/services/parent/parentChildHelper.ts`
     - `backend/services/teacher/teacherHelper.ts`
   - Preserved re-exports at original paths for backward compatibility with existing server actions.
   - Decoupled `backend/services/stats/cache.ts` from `frontend/app/**`.
3. **Server-Only Guardrails**:
   - Installed official `server-only` package (`^0.0.1`).
   - Added `import "server-only";` to `backend/db/prisma.ts`, `backend/auth/authOptions.ts`, `backend/auth/sessionCache.ts`, and all `backend/services/stats/*.ts` modules.
4. **Client Components Cleaned**:
   - `AdminBusManagement.tsx` updated to import pure helpers exclusively from `@/shared/types/transport`.
   - `ExamsClient.tsx` updated to import from `@/shared/types/academics`.
   - `ParentListClient.tsx`, `StudentListClient.tsx`, `TeacherListClient.tsx`, `DataCheckClient.tsx`, `AdminDashboardStatsGrid.tsx`, `useStatsLiveRefresh.ts` updated to import from `@/shared/types/stats`.
   - `UniversalDashboard.tsx` refactored to eliminate direct runtime Prisma queries.
5. **Architectural Boundary Enforcement**:
   - Configured ESLint rule `no-restricted-imports` in `eslint.config.mjs` preventing any file under `frontend/components/**` from importing `@/backend/services/**`, `@/backend/db/**`, `@/backend/auth/**`, or `server-only`.

---

## 3. Failure 2: Render (`vitest.config.ts` TS2307 Missing Module)

### Root Cause
Render builds Node.js applications with `NODE_ENV=production` by default, which executes `npm install --omit=dev`.
`vitest` was installed as a `devDependency`.
When `next build` executed, `tsconfig.json` included root-level `.ts` files, causing `tsc` to type-check `vitest.config.ts`.
Since `vitest/config` was absent from `node_modules`, the type check failed with:
```
vitest.config.ts(1,30): error TS2307: Cannot find module 'vitest/config'
or its corresponding type declarations.
Failed to type check.
==> Build failed
```

### Remediation Applied
1. **Excluded Test Tooling from Production `tsconfig.json`**:
   - Added `vitest.config.ts`, `vitest.setup.ts`, `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`, `tests`, and `__tests__` to `exclude` in `tsconfig.json`.
2. **Dedicated Test TypeScript Configuration**:
   - Created `tsconfig.test.json` extending `./tsconfig.json` with test includes enabled for local development and test runs.
3. **Headless Test Shim for `server-only`**:
   - Configured `vitest.config.ts` to resolve `server-only` to `node_modules/server-only/empty.js` so Vitest suites run in Node without bundler export mismatch errors.
4. **Standardized Scripts**:
   - Added `"typecheck": "tsc --noEmit"` and `"test": "vitest run"` in `package.json`.
5. **Render Dashboard Build Configuration**:
   - In Render Dashboard: **Service** -> **Settings** -> **Build & Deploy** -> **Build Command**.
   - Update to: `npm ci --include=dev && npm run build` (or set Environment Variable `NPM_CONFIG_PRODUCTION=false`).

---

## 4. Excel Import & Database Connection (`EMAXCONNSESSION`)

### Root Cause
1. In production, Supabase provides two connection pooler ports:
   - **Port 5432 (Session Mode)**: Hard-limited to 15 concurrent clients (`pool_size: 15`).
   - **Port 6543 (Transaction Mode)**: Designed for serverless functions (Vercel, AWS Lambda) using `pgbouncer=true`.
2. When concurrent requests hit the portal on port 5432, Supabase rejected incoming connections with:
   `FATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`.
3. In earlier builds on the live portal, when `prisma.class.findMany()` hit this connection error, class resolution failed, marking all 7 spreadsheet rows with `NEEDS_CORRECTION`.

### Verification with Current Code
- Executed `parseAndScanWorkbook` on the user's uploaded `parent & student details.xlsx` file against the live database:
  - **Total Scanned Rows**: 7
  - **Ready to Import**: 7 / 7
  - **Valid Rows**: 7 / 7
  - **Error Rows**: 0
  - **Duplicate Rows**: 0
  - **Conflict Rows**: 0
- Auto-fix rules correctly extracted phone numbers and matched classes `class 1 - section A`, `class 2 - section A`, and `class 3 - section A`.

---

## 5. Security Audit (`npm audit`)

### Initial Scan
- Total Vulnerabilities: 22 (3 critical, 9 high, 10 moderate)

### Action Taken
- Executed `npm audit fix` (safe upgrade without breaking `--force`).
- Fixed 11 vulnerabilities (including `minimatch`, `glob`, `source-map-js`, `undici`).

### Remaining Vulnerabilities & Context
| Package | Severity | Category | Risk / Remediation Path |
|---|---|---|---|
| `xlsx` | High | Runtime (Excel) | Prototype pollution & ReDoS in SheetJS. No npm patch available. Sanitization guards (`sanitizeForSpreadsheet`) are actively enforced in `excelImportEngine.ts`. |
| `next` | Critical | Runtime | Next.js 16.4.4 advisories. Upgrade to 16.4.6 requires testing Next.js Canary/breaking range changes. |
| `nodemailer` | High | Runtime (Auth) | Sub-dependency of `next-auth`. Requires breaking major upgrade to nodemailer v10. |
| `tinypool` / `@vitest/mocker` | Critical / Moderate | Dev-Only (Tests) | Used exclusively during test runs by Vitest. Does not affect production bundles or runtime. |
| `zod` | High | Tooling | Sub-dependency of `@vercel/cli-config` / `@vercel/blob`. Requires breaking major upgrade to zod v4. |

---

## 6. Verification Checklist
- [x] `npm run typecheck` passes with exit code 0.
- [x] `npm test` runs 17 consistency and formula tests and passes 100%.
- [x] `npm audit fix` applied safely.
- [x] Pure types decoupled in `shared/types/`.
- [x] ESLint client/server boundary rule active.
- [x] Git committed and pushed to `origin main` to trigger automated AWS Amplify / Vercel / Render deployment.
