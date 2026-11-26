# SRT Universal School Portal - Notification Pipeline & Audit Map

| # | Trigger / Event | Source File | Calls `NotificationService.send`? | Recipients | Deep Link | Status |
|---|---|---|---|---|---|---|
| 1 | **Direct Chat Message (Text)** | `app/api/messages/route.ts` | Yes (Background async) | Target Receiver (Parent/Teacher/Admin) | `/dashboard/{role}/messages/{senderId}` | Verified Active |
| 2 | **Chat Photo Message** | `app/api/messages/route.ts` | Yes (Background async with image preview) | Target Receiver | `/dashboard/{role}/messages/{senderId}` | Verified Active |
| 3 | **Chat Voice Note / Audio** | `app/api/messages/route.ts` | Yes (Background async) | Target Receiver | `/dashboard/{role}/messages/{senderId}` | Verified Active |
| 4 | **Chat Document / File** | `app/api/messages/route.ts` | Yes (Background async) | Target Receiver | `/dashboard/{role}/messages/{senderId}` | Verified Active |
| 5 | **Admin Broadcast / Announcement** | `backend/api/actions/dashboard/admin/notifications/createNotificationAction.ts` | Yes (via `dispatchNotification` & `NotificationService`) | All Users / Class / Role | `/dashboard/parent` or `/notifications` | Verified Active |
| 6 | **Emergency Alert / Urgent Circular** | `backend/api/actions/dashboard/admin/notifications/createNotificationAction.ts` | Yes (Priority: URGENT) | School Wide | `/dashboard` | Verified Active |
| 7 | **Student Birthday Wish** | `app/api/cron/birthdays/route.ts` & `backend/api/actions/birthdays/` | Yes (Category: BIRTHDAY) | Parent / Student / Teacher | `/dashboard/parent` | Verified Active |
| 8 | **Daily Attendance Update** | `backend/api/actions/attendance/` & `app/api/attendance/` | Yes (Category: ATTENDANCE) | Parent of marked student | `/dashboard/parent/attendance` | Verified Active |
| 9 | **Report Card Published** | `backend/api/actions/reports/` | Yes (Category: REPORT_CARD) | Parent of student | `/dashboard/parent/reports` | Verified Active |
| 10 | **Exam Schedule & Timetable** | `backend/api/actions/exams/` | Yes (Category: ACADEMIC) | Students / Parents / Class Teachers | `/dashboard/parent/exams` | Verified Active |
| 11 | **New Assignment / Homework** | `backend/api/actions/homework/` | Yes (Category: ACADEMIC) | Students / Parents of section | `/dashboard/parent/homework` | Verified Active |
| 12 | **School Bus GPS & Tracking Alert** | `app/api/transport/bus-trigger/route.ts` | Yes (Category: BUS) | Parents of bus route students | `/staff/my-bus` or `/dashboard/parent` | Verified Active |
| 13 | **Leave Request Status Update** | `backend/api/actions/leave/` | Yes (Category: LEAVE) | Teacher / Staff applicant | `/dashboard/teacher/leave` | Verified Active |
| 14 | **Push Subscription Confirmation** | `frontend/components/pwa/PwaWelcomeNotificationPrompt.tsx` via `app/api/push/test/route.ts` | Yes (Category: TEST) | Current registered device | `/dashboard` | Verified Active |
| 15 | **Security Event / Login From New Device**| `backend/auth/` & `proxy.ts` | Yes (Category: ACCOUNT) | Account Owner | `/settings` | Verified Active |

---

## Canonical Notification API Architecture

1. **`NotificationService.send(options)`**: The central canonical pipeline for all system, chat, and automated notifications.
   - **Step 1 (Database Persistence)**: Creates PostgreSQL rows in `Notification` table with unique `dedupeKey` (24h idempotency window).
   - **Step 2 (Outbox & Queue)**: Queues push dispatch with automated retry and dead endpoint pruning (prunes HTTP 404/410 subscriptions).
   - **Step 3 (Multi-Channel Dispatch)**:
     - PC Desktop & iOS Safari PWA: Direct WebPush via VAPID.
     - OneSignal REST API: External ID targeting matched to PostgreSQL `User.id`.
   - **Step 4 (Delivery Logging)**: Sets `deliveredAt` timestamp and logs delivery status in `NotificationDelivery`.
   - **Step 5 (In-App Live Delivery)**: Real-time foreground broadcast via Service Worker `FOREGROUND_NOTIFICATION` and `DashboardNotificationToaster`.
