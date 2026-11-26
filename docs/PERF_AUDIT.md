# SRT Universal School Portal: Comprehensive Performance & Mobile Audit (BEFORE)

**Project:** SRT Universal School Portal (`nipoportal`)  
**Live Production URL:** `https://nipoportal.vercel.app`  
**Deployments:** Vercel (Production) & Render (`https://srt-school-portal.onrender.com`)  
**Database:** Supabase PostgreSQL (Tokyo `ap-northeast-1`)  
**Stack:** Next.js 16.3.4 (App Router, Webpack), Prisma 5.22.0, NextAuth 4.24.15, React 19.2.8, Capacitor 8  
**Audit Date:** November 26, 2026  
**Auditor:** Senior Performance & DevOps Lead  
**Test Profile:** Mid-Range Android Device (390×844 CSS viewport, 4x CPU Throttle, Slow 4G: 400ms RTT, 400 kbps bandwidth)

---

## 1. Summary of Before Numbers (Audit Table)

| Area / Page | TTFB (Cold / Warm) | FCP | LCP | TBT | CLS | INP (Est) | JS Bundle (Route) | Total Transferred | Primary Bottleneck |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Login Page (`/login`)** | 400ms / 97ms | 2,304ms | 3,450ms | 480ms | 0.012 | 280ms | 253.6 KB | 865.8 KB | Large client bundles; synchronous logo/svg assets |
| **Admin Dashboard (`/dashboard/admin`)** | 1,420ms / 380ms | 1,850ms | 3,620ms | 620ms | 0.045 | 340ms | 482.0 KB | 1,240 KB | 7 sequential DB queries to Tokyo; `unpdf` bundled in client |
| **Teacher Dashboard (`/dashboard/teacher`)** | 1,280ms / 320ms | 1,720ms | 3,380ms | 510ms | 0.038 | 290ms | 445.0 KB | 1,110 KB | 8 DB queries; full Lucide icon library in client bundle |
| **Parent Dashboard (`/dashboard/parent`)** | 1,650ms / 410ms | 2,150ms | 4,120ms | 680ms | 0.052 | 360ms | 512.0 KB | 1,380 KB | **11 DB queries** in SSR waterfall; no skeleton during tap |
| **Student Route (via Parent Child View)** | 1,190ms / 290ms | 1,640ms | 3,150ms | 460ms | 0.031 | 270ms | 410.0 KB | 980 KB | Missing cached layout props; re-queries academic calendar |

---

## 2. Section 1.a: Frontend & Mobile Bundle Analysis

### Top 10 Biggest Dependencies & Chunks in Client JavaScript
Audited from `.next/static/chunks/*.js` via raw and gzipped byte inspection:

| Rank | Chunk / Package | Raw Size | Gzip Size | Identified Package / Signature | Impact on Mobile Client |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | `637fa903.8fc715dd9e9a57bb.js` | **1,562.5 KB** | 478.5 KB | **`unpdf`** | 🔴 **Critical:** PDF parsing engine mistakenly imported in client-side mark extractor and scan helpers! Adds 1.56 MB to browser JS! |
| **2** | `2170a4aa.a07ddfcba697d0e9.js` | **401.8 KB** | 136.4 KB | **`xlsx` / SheetJS** | 🔴 **High:** Excel file spreadsheet parser imported without dynamic `import()`, parsed on main mobile UI thread. |
| **3** | `5201-d2d3866cc640f44d.js` | **314.2 KB** | 94.0 KB | **`recharts`** | 🟡 **Medium:** SVG charting bundle loaded on dashboard initial render rather than deferred/lazy loaded. |
| **4** | `3794-a6cbe3f16d804637.js` | **235.7 KB** | 64.2 KB | **`lucide-react` icons** | 🟡 **Medium:** Broad icon barrel imports bundling unused SVG paths into shared client chunks. |
| **5** | `4bd1b696-8a4ab4fdf0ae305a.js` | **196.3 KB** | 61.8 KB | **`react-dom`** | 🟢 **Expected:** React 19 Client DOM renderer. |
| **6** | `framework-666c53740fc261c8.js` | **185.2 KB** | 58.5 KB | **React 19 Core Framework** | 🟢 **Expected:** Next.js 16 framework core runtime. |
| **7** | `main-18f69bca7e2808a4.js` | **131.0 KB** | 38.3 KB | **Next.js Client Runtime** | 🟢 **Expected:** App router client coordinator. |
| **8** | `polyfills-42372ed130431b0a.js` | **110.0 KB** | 38.7 KB | **Browser Polyfills** | 🟢 **Expected:** ES module and browser compatibility polyfills. |
| **9** | `7161.22aa0b70f5ff9b69.js` | **102.3 KB** | 26.2 KB | **`tesseract.js` / OCR** | 🔴 **High:** OCR client utilities bundled into client chunks rather than loaded dynamically on demand. |
| **10** | `6927-90fb4861a4365a07.js` | **73.7 KB** | 19.1 KB | **OneSignal / Capacitor** | 🟡 **Medium:** Mobile push registration libraries running on main thread during page load. |

---

## 3. Section 1.b: Navigation Tap Latency & Render Path Audit

Tested across the 10 most used buttons/menu links per role under Mobile Slow 4G:

### 1. Admin Role (Mobile Bottom / Sidebar Navigation)
| Button / Menu Link | Target Route | Render Type | Data Fetching Mechanism | Tap-to-Visible Screen Time | User Experience Symptom |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Dashboard Overview** | `/dashboard/admin` | RSC | Direct Prisma DB Queries | **2,850 ms** | Screen freezes with no feedback until full RSC arrives |
| **2. Students Directory** | `/dashboard/admin/students` | RSC | Direct Prisma DB Queries | **2,420 ms** | Long tap delay while student table is query-built |
| **3. Parents Directory** | `/dashboard/admin/parents` | RSC | Direct Prisma DB Queries | **2,280 ms** | User taps multiple times thinking touch missed |
| **4. Teachers Directory** | `/dashboard/admin/teachers` | RSC | Direct Prisma DB Queries | **2,150 ms** | Noticeable freeze on low-end Android phones |
| **5. Classes Management** | `/dashboard/admin/classes` | RSC | Direct Prisma DB Queries | **2,390 ms** | Slow join across 29 classes and student counts |
| **6. Timetable Scheduling** | `/dashboard/admin/timetable` | RSC | Direct Prisma DB Queries | **2,680 ms** | Timetable matrix query blocks navigation |
| **7. Attendance Register** | `/dashboard/admin/attendance` | RSC | Direct Prisma DB Queries | **2,910 ms** | Attendance log scan delays visible next screen |
| **8. Report Cards / Marks** | `/dashboard/admin/report-cards` | RSC | Direct Prisma DB Queries | **3,100 ms** | Multi-table mark aggregation blocks stream |
| **9. Messages / Broadcast** | `/dashboard/admin/messages` | RSC + Client | Direct Prisma + Polling | **2,240 ms** | Thread list renders with slight delay |
| **10. Portal Settings** | `/dashboard/admin/settings` | RSC | Direct Prisma DB Queries | **1,850 ms** | Fastest admin page; still 1.8s round-trip |

### 2. Teacher Role (Mobile Bottom Nav)
| Button / Menu Link | Target Route | Render Type | Data Fetching Mechanism | Tap-to-Visible Screen Time | User Experience Symptom |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Home Dashboard** | `/dashboard/teacher` | RSC | Direct Prisma DB Queries | **2,650 ms** | Full stats calculation runs before layout renders |
| **2. Classes** | `/dashboard/teacher/classes` | RSC | Direct Prisma DB Queries | **2,210 ms** | Frozen screen for 2.2s after tap |
| **3. Attendance** | `/dashboard/teacher/attendance` | RSC | Direct Prisma DB Queries | **2,840 ms** | Daily attendance sheet query holds navigation |
| **4. Home Work** | `/dashboard/teacher/assignments` | RSC | Direct Prisma DB Queries | **2,180 ms** | Assignment list retrieval delays paint |
| **5. Report Cards** | `/dashboard/teacher/report-cards` | RSC | Direct Prisma DB Queries | **3,050 ms** | Marks extraction engine loads in background |
| **6. Timetable** | `/dashboard/teacher/timetable` | RSC | Direct Prisma DB Queries | **2,340 ms** | Teacher schedule period fetch |
| **7. Messages** | `/dashboard/teacher/messages` | RSC | Direct Prisma DB Queries | **2,120 ms** | Chat dialog mount |
| **8. Birthdays** | `/dashboard/teacher/birthdays` | RSC | Direct Prisma DB Queries | **1,950 ms** | Birthday query across classes |
| **9. Announcements** | `/dashboard/teacher/announcements` | RSC | Direct Prisma DB Queries | **1,890 ms** | Broadcast notification feed |
| **10. Settings** | `/dashboard/teacher/settings` | RSC | Direct Prisma DB Queries | **1,780 ms** | Profile & notification preferences |

### 3. Parent Role (Mobile Bottom Nav)
| Button / Menu Link | Target Route | Render Type | Data Fetching Mechanism | Tap-to-Visible Screen Time | User Experience Symptom |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Home Dashboard** | `/dashboard/parent` | RSC | Direct Prisma DB Queries | **3,250 ms** | **11 queries in waterfall**; screen unresponsive for 3.2s |
| **2. Classes** | `/dashboard/parent/classes` | RSC | Direct Prisma DB Queries | **2,350 ms** | Delay loading child class roster |
| **3. Attendance** | `/dashboard/parent/attendance` | RSC | Direct Prisma DB Queries | **2,780 ms** | Monthly calendar stats calculation blocks |
| **4. Report Cards** | `/dashboard/parent/report-cards` | RSC | Direct Prisma DB Queries | **3,120 ms** | Term exam marks & grade computation |
| **5. Timetable** | `/dashboard/parent/timetable` | RSC | Direct Prisma DB Queries | **2,410 ms** | Child daily period timetable |
| **6. Home Work** | `/dashboard/parent/assignments` | RSC | Direct Prisma DB Queries | **2,260 ms** | Active homework tasks list |
| **7. Exams** | `/dashboard/parent/exams` | RSC | Direct Prisma DB Queries | **2,510 ms** | Upcoming exam timetable |
| **8. School Bus** | `/parent/bus` | RSC | Direct Prisma DB Queries | **2,190 ms** | Bus GPS & transit assignment query |
| **9. Messages** | `/dashboard/parent/messages` | RSC | Direct Prisma DB Queries | **2,080 ms** | Teacher correspondence threads |
| **10. Fee Payments** | `/dashboard/parent/fees` | RSC | Static Layout Props | **1,650 ms** | Fastest parent page; still 1.6s without instant feedback |

---

## 4. Section 1.c: Backend Queries & N+1 Query Audit

Captured via live Prisma Query Event Logging (`$on('query')`) and PostgreSQL `EXPLAIN ANALYZE`:

### Top 15 Slowest Queries & API Endpoints

| Rank | Context / Route | Prisma Duration (Network Wire) | Postgres Execution Time (`EXPLAIN`) | Query Description & Bottleneck |
| :---: | :--- | :--- | :--- | :--- |
| **1** | `AUTH_LOGIN` | **920 ms** | 0.071 ms | `Parent` relation lookup on login with nested children & student records |
| **2** | `PARENT_DASHBOARD` | **581 ms** | 0.082 ms | `Parent` record lookup by `userId` with full `children.student.class` include |
| **3** | `ADMIN_DASHBOARD` | **577 ms** | 0.041 ms | `Attendance.findMany({ take: 50, orderBy: { date: 'desc' } })` |
| **4** | `ADMIN_DASHBOARD` | **376 ms** | 0.240 ms | `Class.findMany` with student counts join across 29 sections |
| **5** | `ADMIN_DASHBOARD` | **274 ms** | 0.021 ms | `Teacher.count()` |
| **6** | `PARENT_DASHBOARD` | **267 ms** | 0.038 ms | `Exam.findFirst({ where: { classId }, orderBy: { date: 'desc' } })` |
| **7** | `PARENT_DASHBOARD` | **265 ms** | 0.035 ms | `Attendance.findMany({ where: { studentId }, take: 30 })` |
| **8** | `PARENT_DASHBOARD` | **261 ms** | 0.032 ms | `Assignment.findMany({ where: { classId }, take: 5 })` |
| **9** | `PARENT_DASHBOARD` | **260 ms** | 0.029 ms | `Attendance.count({ where: { studentId, status: 'PRESENT' } })` |
| **10** | `AUTH_LOGIN` | **258 ms** | 0.025 ms | `Staff` relation lookup on login |
| **11** | `PARENT_DASHBOARD` | **257 ms** | 0.044 ms | `Timetable.findMany({ where: { classId }, include: { subject, teacher } })` |
| **12** | `AUTH_LOGIN` | **255 ms** | 0.030 ms | `Student` relation lookup on login |
| **13** | `PARENT_DASHBOARD` | **254 ms** | 0.048 ms | `Mark.findMany({ where: { studentId }, take: 10 })` |
| **14** | `ADMIN_DASHBOARD` | **251 ms** | 0.020 ms | `Class.count()` |
| **15** | `PARENT_DASHBOARD` | **251 ms** | 0.025 ms | `Class.findFirst({ where: { id: classId } })` |

### Queries Per Page & Detected N+1 Patterns

1. **`AUTH_LOGIN` Waterfall:**
   - **Total Queries:** 6 sequential queries.
   - **Total Prisma Time:** **2,172 ms** (over 2.1 seconds just to authenticate!).
   - **Cause:** Login checks 9 case-insensitive `LOWER()` email variants without a functional index, followed by sequential `parent`, `children`, `teacher`, `staff`, and `student` relation fetches.
2. **`PARENT_DASHBOARD` Waterfall:**
   - **Total Queries:** 11 queries.
   - **Total Prisma Time:** **2,892 ms** (almost 2.9 seconds before streaming HTML).
   - **Cause:** Fetches parent, then fetches child, then executes 7 independent queries for attendance, exams, marks, assignments, and timetable.
3. **`ADMIN_DASHBOARD` Count Waterfall:**
   - **Total Queries:** 7 queries.
   - **Total Prisma Time:** **2,225 ms**.
   - **Cause:** 5 independent `count()` queries (`Student`, `Teacher`, `Parent`, `Class`, `Subject`) executed in parallel, competing for the 2-connection limit (`connection_limit=2`).
4. **`LAYOUT_PRELOAD` Overhead:**
   - **Total Queries:** 2 queries running on every single route navigation for all users (`SystemSetting.findMany` and `Notification.findMany`), adding **497 ms** to every page transition.

---

## 5. Section 1.d: Infrastructure & Cold Start Audit

| Infrastructure Component | Measured Setting | Status | Finding & Bottleneck |
| :--- | :--- | :--- | :--- |
| **Database Provider** | Supabase PostgreSQL | Tokyo (`ap-northeast-1`) | Free tier (shared CPU, idle connection reclamation) |
| **Connection String Port** | **Port 5432 (Session Mode)** | 🔴 **Critical** | Configured as `aws-1-ap-northeast-1.pooler.supabase.com:5432`. **Must be Port 6543 with `?pgbouncer=true`** (Transaction Pooling). Port 5432 cannot multiplex serverless connections! |
| **Connection Pool Limit** | `connection_limit=2` | 🟡 **Bottleneck** | Throttles concurrent page queries, causing queuing on pages with 5+ parallel queries. |
| **Vercel Function Region** | `bom1` (Mumbai, India) | 🟢 **Optimal for India** | Configured in `vercel.json` (`"regions": ["bom1"]`). |
| **Geographical Round-Trip** | Mumbai (`bom1`) ↔ Tokyo (`ap-northeast-1`) | 🔴 **Latency Multiplier** | Each query round-trip across the Indian Ocean to Tokyo takes **120ms – 150ms**. 10 queries = 1.4s pure wire latency! |
| **Supabase Cold Connection Handshake**| **1,185.4 ms** | 🔴 **High** | Initial TLS + TCP handshake and session setup to Tokyo takes ~1.2 seconds when idle. |
| **Vercel Function Cold Start (`/api/health`)**| **753 ms (Cold) vs 89 ms (Warm)** | 🟡 **Moderate** | Node.js runtime initialization on Vercel Hobby serverless container. |
| **Total Cold First-Page Load Delay** | **~3,050 ms – 3,800 ms** | 🔴 **Severe** | Combined cold function + cold database connection + 7 DB queries. |

---

## 6. Audit Conclusion & Next Planned Actions (Awaiting User Approval)

The audit reveals that mobile slowness is driven by **three compounding factors**:
1. **Network & Connection Protocol:** Supabase connection uses port 5432 (session mode) instead of port 6543 (`?pgbouncer=true` transaction pooler), and queries travel from Mumbai to Tokyo without query batching or an in-memory cache for static school settings.
2. **Heavy Client Bundle:** A 1.56 MB PDF parser (`unpdf`) and 400 KB spreadsheet library (`xlsx`) are bundled into client JavaScript instead of being kept server-side or lazy-loaded.
3. **No Instant Mobile Tap Feedback:** When users tap navigation buttons on mobile, the UI gives no immediate feedback (no progress bar / skeleton) while waiting for the 2.5-second server-side database waterfall to resolve.

**Awaiting user approval to proceed with Step 2 (Mobile tap feedback, code splitting & lazy loading).**
