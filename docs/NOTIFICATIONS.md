# SRT Universal School Management Portal — Universal Push Notification System

## 1. Overview & Push Outbox Pattern
The notification subsystem delivers instant lock-screen alerts, birthday cards, attendance updates, academic announcements, and exam notices across Android, iOS, and Desktop devices.

### Transactional Outbox Pipeline
```
[Event Trigger] 
       │
       ▼
[Insert DB Notification & PushOutbox (status: PENDING)]
       │
       ▼
[Parallel Dispatch: OneSignal REST API + Direct VAPID WebPush]
       │
       ├─► Success: PushOutbox status -> COMPLETED
       │
       └─► Failure: Retry with exponential backoff (attempts < 5)
                    Attempts >= 5 -> status: DEAD_LETTER
```

---

## 2. Channels & Fallbacks
1. **Primary Push**: OneSignal External User ID targeting (`sendOneSignalPush`).
2. **Auxiliary Fallback**: Direct WebPush with VAPID keys (`TTL: 86400` / 24 hours, `urgency: high`). Ensures sleeping or Doze-mode Android phones receive notifications upon reconnecting.
3. **Dead Endpoint Pruning**: When a push provider returns HTTP 404 or 410 (Gone), all associated subscriptions are pruned immediately from `prisma.pushSubscription`, `pwaSubscription`, and `deviceNotificationsRegistry`.

---

## 3. External Trigger & Outbox Drain Endpoint
- **Endpoint**: `/api/notifications/outbox/process` (POST / GET).
- **Background Cron**: Pinged every 5 minutes by `.github/workflows/keep-alive.yml` to ensure zero stuck notifications even in serverless environments.
- **Dead-Letter Retry**: Supports `{ "action": "retry_dead_letter" }` to reset dead letters to `PENDING`.

---

## 4. Admin Diagnostics & Test Push
- **Admin Diagnostics API**: `/api/push/diagnostics` provides:
  - Runtime environment configuration check (lengths & presence only, no secrets).
  - Outbox status summary: Pending count, Delivered in last 24h, Dead-letter count, and Last processed timestamp.
  - Per-user deep diagnostic inspection via `userId=<id>`.
- **Admin Header "Test Push" Button**: Dispatches test alert strictly to the current logged-in admin's own devices (`broadcast: false`). Broadcasts are strictly restricted to the Announcements composer.
