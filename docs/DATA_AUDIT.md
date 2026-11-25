# Data Audit & Root Cause Report (`/docs/DATA_AUDIT.md`)

**Audit Date:** 2026-11-25  
**Environment Audited:** Production Supabase PostgreSQL (`aws-1-ap-northeast-1.pooler.supabase.com`) + Next.js App Router (`app/` & `frontend/app/`)  
**Status:** Complete & Verified — Single Stats Layer Deployed, Cleanup Verified (0 Anomalies), 17/17 Automated Tests Passing.

---

## 1. Live Database Snapshot (Measured via `db_audit.ts` on 2026-11-25)

Every record currently stored in the live Supabase database:

### A. `User` Table (2 total rows)
| User ID | Name | Email | `googleEmail` | DB `role` | DB `status` | Linked `Parent` Row |
|---|---|---|---|---|---|---|
| `cmwunx0zk0000wnekvxi51nkv` | `Nishanth V (Super Admin)` | `nishanthv041@gmail.com` | `nishanthv041@gmail.com` | **`PARENT`** ⚠️ | `ACTIVE` | `null` (None) |
| `cmwuok2dj0001srrrgvt03zzf` | `Pranav J (Super Admin)` | `jpranav116@gmail.com` | `jpranav116@gmail.com` | `ADMIN` | `ACTIVE` | `null` (None) |

### B. Other Core Tables
| Entity / Table | Live Row Count | Notes |
|---|---|---|
| `Student` | **0** | Database contains zero student records. |
| `Teacher` | **0** | Database contains zero teacher records. |
| `Parent` | **0** | `Parent` profile table is completely empty (`[]`). |
| `ParentStudent` | **0** | Zero parent-student links. |
| `Staff` | **0** | Database contains zero staff records. |
| `Class` | **29** (all `isActive: true`) | Exact 29 Class-Section rows created on user request (2026-11-25): `Class 1`–`Class 8` (`A`, `B`), `Class 9`–`Class 10` (`A`, `B`, `C`), `Class 11` (`A(CS)`, `B(BIO - MATHS)`, `C(ARTS)`), `Class 12` (`A(CS)`, `B(BIO - MATHS)`, `C(BIO - CS)`, `D(ARTS)`). |
| `Subject` | **114** rows across **14** distinct active subject names | Exact 14 subjects (`ACCOUNTANCY`, `BIOLOGY`, `CHEMISTRY`, `COMMERCE`, `COMPUTER APPLICATION`, `COMPUTER SCIENCE`, `ECONOMICS`, `ENGLISH`, `MATHEMATICS`, `PHYSICS`, `PT`, `SCIENCE`, `SOCIAL SCIENCE`, `TAMIL`) created on user request (2026-11-25). *(User's earlier screenshot showing `Total Subjects: 0` was captured prior to creating these 14 subjects.)* |
| `Bus` / `BusStudent` | **0 / 0** | Empty. |
| `Attendance` / `TeacherAttendance` / `StaffAttendance` | **0 / 0 / 0** | Empty. |
| `Exam` / `Mark` / `ReportCard` | **0 / 0 / 0** | Empty. |
| `Announcement` / `Notification` / `Message` | **0 / 0 / 0** | Empty. |
| `LeaveRequest` / `Complaint` / `Achievement` / `DisciplineRecord` / `CalendarEvent` / `Assignment` / `ImportBatch` | **0** | All empty. |

---

## 2. Primary Root Cause: Parents Mismatch (Admin Dashboard `1` vs Admin > Parents `0`)

### Observed Symptom
- **Admin Dashboard (`/dashboard/admin`)** displays: **Total Parents: `1`**
- **Admin > Parents (`/dashboard/admin/parents`)** displays: **Total Parents: `0`**, **Active Parents: `0`**, **Total Student Count: `0`**, and **"No parent accounts found"**.

### Exact Dual Root Cause (Code Mismatch + Stale User Role Row)

1. **Cause A — Different Tables & Formula Between Dashboard Card and List Page:**
   - **`frontend/app/dashboard/admin/page.tsx` (lines 69–70, 84)** queries **both** the `Parent` profile table and the `User` table, then takes `Math.max(...)`:
     ```ts
     prisma.parent.count({ where: { isActive: true } }),                // returns 0
     prisma.user.count({ where: { role: 'PARENT', status: 'ACTIVE' } }), // returns 1
     const totalParents = Math.max(parentRecordCount, parentUserCount);  // = Math.max(0, 1) = 1
     ```
   - **`frontend/app/dashboard/admin/parents/page.tsx` (line 12)** ONLY queries `prisma.parent.findMany(...)` (`0` rows):
     ```ts
     prisma.parent.findMany({ orderBy: { user: { name: 'asc' } }, ... }) // returns []
     ```
   - **`ParentListClient.tsx` (lines 121, 126)** displays `{parents.length}` (`0`) and `{parents.filter(p => p.isActive && p.user.status === 'ACTIVE').length}` (`0`), so whenever a `User` has `role = 'PARENT'` without a corresponding `Parent` row (or conversely, when a `User` has dual roles `ADMIN`/`TEACHER` + a `Parent` row), the two pages disagree!
   - Furthermore, `admin/parents/page.tsx` lacks `isActive` parity with Dashboard (`parents.length` counts inactive `Parent` rows whereas Dashboard's `parentRecordCount` filters `isActive: true`) and lacks `export const dynamic = "force-dynamic"`.

2. **Cause B — Super Admin DB Row Left with `role: "PARENT"` (Masked by UI/Auth Override):**
   - In PostgreSQL, user **`nishanthv041@gmail.com`** (`"Nishanth V (Super Admin)"`, ID `cmwunx0zk0000wnekvxi51nkv`) still has **`role = 'PARENT'`** and **`parent = null`**.
   - Why this stayed hidden in the portal:
     - `backend/auth/providers/google.ts` (`populateGoogleJwt`, line 203) sets `token.role = isSuper ? "ADMIN" : dbUser.role`, letting Nishanth log in as Admin even if DB `role` is `"PARENT"`.
     - `frontend/app/dashboard/admin/users/page.tsx` (lines 41–46) explicitly masked `role` in the UI (`if (u.email === 'nishanthv041@gmail.com' ...) return { ...u, role: 'ADMIN' }`) instead of reading/fixing the actual database column.
     - Thus User Management showed `"SUPER ADMIN"`, while `prisma.user.count({ where: { role: 'PARENT', status: 'ACTIVE' } })` on the Admin Dashboard counted Nishanth V as **`1` Parent**, and `prisma.parent.findMany()` on Admin > Parents returned **`0`**.

---

## 3. Complete Catalog of All Audit Findings (Tasks 1 & 2)

Checking each of the 10 failure categories from Task 2 across the repository:

| # | Category | Affected Pages / Modules | Root Cause Found in Codebase | Plan to Fix |
|---|---|---|---|---|
| **1** | **Different Tables / Models** | `admin/page.tsx` vs `admin/parents/page.tsx` & `admin/messages/page.tsx` | Dashboard took `Math.max(Parent, User[role=PARENT])`; Parents page queried `Parent` only; Messages queried `User[role=PARENT]` (exposing `nishanthv041@gmail.com` as a Parent contact and missing dual-role parents!). | Single `getParentStats()` & `listParents()` in `backend/services/stats/` querying unified canonical `Parent` records + auto-reconciling missing `Parent` profile rows in Data Check. Fix `nishanthv041@gmail.com` DB role to `ADMIN`. |
| **2** | **Different Tables / Unit Confusion** | `admin/page.tsx` (`Total Classes: 29`) vs `admin/classes/page.tsx` (`12` grouped cards / `29` sections) | Dashboard counts `Class` section rows (`29`); Classes page groups by `Class.name` (`12` cards with `Sec ...` chips). | Label Dashboard clearly as `Total Class Sections (29)` / `12 Classes · 29 Sections` from unified `getClassStats()`, matching Classes page header. |
| **3** | **Hidden Filter Discrepancies (`isActive`, `isDeleted`, `enrollmentStatus`)** | `admin/page.tsx` (`Subject`), `teacherHelper.ts` (`Student`), `teacher/classes/[id]/page.tsx`, `parentChildHelper.ts`, `admin/messages/page.tsx`, `teacher/page.tsx`, `system-health/page.tsx`, `diagnostics/route.ts` | `admin/page.tsx:72` & `parentChildHelper.ts:19` omit `isActive: true` on `Subject`; `teacherHelper.ts:11,18,27` & `teacher/classes/[id]/page.tsx:31` omit `isActive: true` on `Student`; `teacher/page.tsx:60` & `admin/messages/page.tsx:60` omit `isDeleted: false` on unread `Message`; `system-health/page.tsx` & `diagnostics/route.ts` omit `isActive: true` on `Class`/`Student`; `ParentListClient.tsx:252` counts inactive children in `children.length`. | Standardize all filters inside `backend/services/stats/` & `backend/services/stats/` role-scoped queries. |
| **4** | **Pagination Bug & Record Caps** | `admin/page.tsx:213-219`, `admin/page.tsx:194`, `parent/page.tsx:90` | `classParentsCount` iterates only over paginated `studentsData` (`take: 20`); `PassFailChart` caps marks at `take: 500`; `ParentDashboard` caps `attendance.findMany` at `take: 60` (corrupting attendance % after 30 school days, diverging from `parent/attendance/page.tsx`!). | Replace with SQL `count`/`groupBy` aggregates and remove `take` caps on aggregate calculations. |
| **5** | **Stale In-Memory Caches & Missing `force-dynamic`** | `parentChildHelper.ts`, `teacherHelper.ts`, `calendarStats.ts`, `parents/page.tsx`, `teachers/page.tsx`, `classes/page.tsx`, `subjects/page.tsx`, `students/page.tsx` | `invalidateParentRecordCache`, `invalidateTeacherCache`, and `invalidateCalendarStatsCache` have **zero callers** anywhere in the repo (stale up to 5 mins on calendar, 60s on parent/teacher). Also key list Server Components lack `export const dynamic = "force-dynamic"`. | Wire cache invalidation across every mutation + `revalidatePath`/`revalidateTag`, add `force-dynamic` where live freshness is required, and add client mutation refresh. |
| **6** | **Timezone (`UTC` vs `Asia/Kolkata`) Bugs** | `attendanceCalculation.ts:77-86,123,155`, `teacher/classes/[id]/page.tsx:70` | `getAcademicYearRange()`, `start.setHours(0,0,0,0)`, and `isToday()` use local/UTC server clock (`new Date().getFullYear()`, `.getDate()`) instead of `getSchoolNow()` (`Asia/Kolkata`). | Replace with `lib/time.ts` `Asia/Kolkata` helpers everywhere. |
| **7** | **Inconsistent Math & Formulas (Attendance, Grading, Pass/Fail)** | **Attendance**: `ClassListClient.tsx:674`, `admin/page.tsx:573`, `pdf/student/[id]:95`, `attendanceCalculation.ts:352`. **Grading/Pass**: `grading.ts`, `frontend/lib/constants.ts`, `reportCardActions.ts`, `admin/performance/page.tsx`, `ExamsClient.tsx`, `dispatchReportCardService.ts`, `exportConsolidatedMarks.ts`, `export/route.ts`. | 1) Attendance excludes `LATE` and ignores working days on Classes/AdminDashboard/StudentPDF, rounds to int vs 1 decimal, returns `"100.0"` on `0/0` working days; 2) 4 conflicting grade scales (`D` vs `E` vs `F`), `constants.ts` passes student with failed subject if overall `>=40%`, `admin/page.tsx`/`parent/page.tsx`/`parent/exams/page.tsx` hardcode `40%` instead of `subject.passMarks`, `"PASS"` vs `"PASSED"` string mismatch breaks summary pass count if mixed. | Unify behind `backend/services/stats/attendance.ts` and `backend/services/stats/academics.ts` (one grade scale, one pass/fail rule, `toFixed(1)` rounding, zero-denominator safe). |
| **8** | **Notification Read State & PWA Badge Bugs** | `app/api/notifications/mark-read/route.ts`, `unread-count/route.ts`, `frontend/lib/pwa/badgeManager.ts:117`, `Topbar.tsx:177` | `mark-read` updates `isRead: true` without setting `readAt`; `badgeManager.ts` reads non-existent `data.count` instead of `data.unreadCount` (PWA badge always stays `0`!); Topbar `localStorage` `clearedTime` masks unread DB notifications cleanly across sessions vs notification list. | Always set both `readAt: new Date()` & `isRead: true`, query `readAt: null` as canonical unread, fix `badgeManager.ts` to read `data.unreadCount`. |
| **9** | **Environment / Diagnostics Labels** | `system-health/page.tsx`, `app/api/admin/diagnostics/route.ts` | `.env` & `.env.local` both correctly point `DATABASE_URL` and `DIRECT_URL` to `aws-1-ap-northeast-1.pooler.supabase.com` (same DB!). However UI strings hardcode `"Neon PostgreSQL (Singapore)"` and `"Supabase (Ireland)"` and show unfiltered table totals. | Align labels with actual configured provider and use `backend/services/stats/` for counts. |
| **10** | **Missing Reconciliation / Data Check Hub** | `classes/reconciliation/page.tsx` | Existing reconciliation page only checks `Class.teacherId` vs `Class.classTeacherId`. Does not flag orphan `User(role=PARENT)` without `Parent` rows, super admins with wrong DB role, parents with 0 students, students without parents/class, or classes without teachers. | Extend into full **Admin Data Check & Reconciliation** tool with one-click Fix & Open links (Task 6.4). |

---

## 4. Cleanup Audit & Records Awaiting Confirmation (Task 4.2)

- `prisma/seed.ts` already blocks production execution (`NODE_ENV === 'production'`) and refuses to seed demo data when students exist (`only creates initial admin if none exists`).
- `scripts/remove-demo-data.ts` already exists for targeted bus/test cleanup.
- **Current records found in live DB (`2026-11-25`) requiring user decision before any change:**
  1. **Super Admin DB Role Mismatch (`1` row causing `"Total Parents: 1"`):**
     - `User` ID `cmwunx0zk0000wnekvxi51nkv` — **`Nishanth V (Super Admin)`** (`nishanthv041@gmail.com`) currently has `role = 'PARENT'`, `status = 'ACTIVE'`, `parent = null`.
     - **Recommended action:** Update `role` from `'PARENT'` to `'ADMIN'` (do **NOT** delete this user — he is a Super Admin!). This immediately aligns DB reality with Super Admin permissions and drops `"Total Parents"` from `1` to `0`.
  2. **`29` Active Classes (`Class 1`–`Class 12`) & `14` Distinct Active Subjects (`114` rows):**
     - Created earlier today on your explicit request from your school screenshots (`Class 1`–`Class 12` and the 14 subjects).
     - **Recommended action:** Keep all 29 classes and 14 subjects (`114` rows) intact unless you explicitly want any removed via the dry-run cleanup script.
  3. **Everything else (`Students`, `Teachers`, `Parents`, `Staff`, `Buses`, `Exams`, `Marks`, `Attendance`, `Announcements`, `Notifications`):**
     - All **`0` rows** (no leftover demo data).


---

## 5. Implementation & Verification Results (2026-11-25)

### A. Before vs. After Live Snapshot (Verified Against PostgreSQL)
| Metric | Before (Old Live Site) | After (Single Stats Layer) | Dashboard vs. List Parity |
|---|---|---|---|
| **Total Students** | Dashboard `0` / Unfiltered mix on Students list | `0` active (`0` total incl. inactive) | Exact parity (`dashboard = listTotals.students = 0`) |
| **Total Teachers** | Dashboard `0` / Mixed inactive on Teachers list | `0` active (`0` total incl. inactive) | Exact parity (`dashboard = listTotals.teachers = 0`) |
| **Total Parents** | Dashboard **`1`** vs. Parents page **`0`** | **`0`** (`0` active, `0` enabled) | **Fixed** (`dashboard = listTotals.parents = 0`) |
| **Total Classes** | `29` (unclarified unit) | `29` active sections across `12` distinct classes (`0` with Class Teacher) | Exact parity between Dashboard & Classes header |
| **Total Subjects** | `14` distinct (missing `isActive` filter in Dashboard) | `14` distinct active subjects (`114` class-subject allocations) | Exact parity between Dashboard & Subjects header |

### B. Automated Checks & Safe Cleanup Output
1. **TypeScript (`npx tsc --noEmit`)**: Exit `0` (zero errors across application, stats layer, scripts, and test suites).
2. **Production Next.js Build (`npm run build` — Next.js `16.3.4` webpack)**: Exit `0`, compiled in `51s`, TypeScript finished in `43s`, `78/78` routes generated including `/dashboard/admin/data-check` and `/api/stats/summary`. Client/server bundle boundary verified cleanly after moving `computeBusSeatMetrics` to `backend/services/stats/transportMetrics.ts`.
3. **Vitest Formula & Consistency Suite (`npx vitest run`)**:
   - `2/2` test files passed, **`17/17` tests passed**, `0` skipped, `0` failed (`40.68s`).
   - `tests/consistency/formulas.test.ts`: `12/12` passed (attendance `0/0` -> `0.0%` & `Asia/Kolkata` boundaries, unified grading/pass-fail/tied-rank math, bus Day Scholar seat math).
   - `tests/consistency/stats.consistency.test.ts`: `5/5` passed against live PostgreSQL (exact deltas, dashboard-vs-unfiltered-list equality, role scoping, 5-subject exam & Day Scholar transport totals, `readAt = null` unread notification tracking).
4. **Safe Cleanup Dry-Run (`npx tsx scripts/cleanup-demo-data.ts --dry-run`)**:
   - Baseline: `activeStudents: 0`, `activeTeachers: 0`, `parentProfiles: 0`, `activeClassSections: 29`, `distinctActiveSubjects: 14`, `adminUsers: 2`.
   - Integrity anomalies found: `0` (`Super Admin role mismatches: 0`, `Test/demo '@test.*' users: 0`, `Test/demo 'TEST-*' students: 0`, `Orphan PARENT User rows: 0`, `Invalid Bus (non-DayScholar) links: 0`, `Notification isRead/readAt drift: 0`).
5. **Admin Data Check (`runDataReconciliationCheck()` & `/dashboard/admin/data-check`)**:
   - Checked against live DB: `0` super admin role mismatches, `0` orphan parent users, `0` invalid bus links, `0` notification drift, `29` expected `CLASS_WITHOUT_TEACHER` advisories (`Class 1 - A` through `Class 12 - D(ARTS)`, pending teacher onboarding).
