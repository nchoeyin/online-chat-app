# Online Chat App — Implementation Plan

Stack: **Angular 19 · Django 5 (DRF + Channels) · PostgreSQL 16 · Redis · Celery · S3/MinIO**

Features delivered: 1:1 chat, group chat, delivery guarantee (never silently lost), offline storage, presence.

---

## Phase 0 — Decisions & repo layout

**Stack pinned to your choices**

- Frontend: Angular 19 (already scaffolded).
- API: Django 5 + DRF + SimpleJWT.
- Realtime: Django Channels (ASGI via Daphne/uvicorn) — gives WebSockets inside the same Django process and code as REST.
- Message bus / fan-out / presence: Redis (channel layer + sorted sets). This is the spec's "Redis Pub/Sub" option and pairs naturally with Channels. Kafka stays optional via an outbox publisher later.
- Async jobs: Celery with Redis broker (push notifications, offline fan-out, image thumbs).
- Database: PostgreSQL 16, with the `messages` table range-partitioned by month.
- Media: S3-compatible (MinIO locally, S3 in prod), uploaded via presigned URLs so files never traverse Django.
- Local orchestration: docker-compose (postgres, redis, minio, backend, celery, frontend).

**Repo layout**

```
online-chat-app/
├─ src/, angular.json, ...        ← Angular stays here
├─ backend/
│  ├─ manage.py
│  ├─ requirements.txt
│  ├─ config/
│  │  ├─ settings/{base,dev,prod}.py
│  │  ├─ urls.py
│  │  ├─ asgi.py            ← mounts both HTTP and WS routes
│  │  └─ celery.py
│  └─ apps/
│     ├─ accounts/          ← user, JWT auth
│     ├─ chat/              ← channels, memberships, messages, receipts, consumers
│     └─ media/             ← presigned upload URLs
└─ infra/
   ├─ docker-compose.yml
   ├─ Dockerfile.backend
   └─ nginx/                ← optional TLS / WS upgrade proxy for prod
```

**Acceptance:** `docker-compose up` boots Postgres, Redis, MinIO, Django, Celery — even if Django only serves `/healthz`.

---

## Phase 1 — Backend skeleton + database

1. Create the Django project `config` and install: Django, djangorestframework, djangorestframework-simplejwt, django-cors-headers, channels, channels-redis, daphne, psycopg[binary], redis, celery, boto3, django-environ.
2. Settings split:
   - `base.py`: apps, DRF defaults, JWT, Channels `CHANNEL_LAYERS` pointing at Redis, Postgres `DATABASES`, CORS for `http://localhost:4200`.
   - `dev.py`: `DEBUG=True`, permissive CORS.
   - `prod.py`: `DEBUG=False`, `ALLOWED_HOSTS` from env, secure cookies.
3. `asgi.py`: `ProtocolTypeRouter` mounting `URLRouter` for HTTP (Django) plus `AuthMiddlewareStack(URLRouter(chat.routing.websocket_urlpatterns))` for WS.
4. Run `manage.py migrate` to confirm Postgres works.

**Acceptance:** `GET /healthz` returns 200; `wscat ws://localhost:8000/ws/ping/` echoes (after Phase 5).

---

## Phase 2 — Accounts & JWT auth

1. Custom `User` model in `apps/accounts/models.py` (always do this on day 1, even if it just inherits `AbstractUser`).
2. Endpoints in `apps/accounts/views.py`:
   - `POST /api/auth/register` — email, username, password
   - `POST /api/auth/login` — returns `{access, refresh}` (SimpleJWT)
   - `POST /api/auth/refresh`
   - `GET  /api/auth/me`
3. **WebSocket auth:** write a tiny `JWTAuthMiddleware` for Channels that reads `?token=<jwt>` from the connect URL and attaches `scope["user"]`. Cookies don't reach the WS handshake cleanly cross-origin, so query-string token is the simplest robust pattern.

**Acceptance:** login returns tokens; `/me` works with `Authorization: Bearer …`; a WS connect with a valid token populates `scope["user"]`, an invalid one closes with code 4401.

---

## Phase 3 — Channels & memberships (covers 1:1 + group)

**Schema (`apps/chat/models.py`):**

- `Channel(id UUID, type ENUM('dm','group'), name NULL, created_by, created_at)`
- `Membership(channel, user, role ENUM('owner','admin','member'), joined_at, last_read_message_id BIGINT NULL, muted BOOL)` with `UniqueConstraint(channel, user)`

**Crucial rule:** 1:1 DMs are just `type='dm'` channels with exactly two memberships. Same code path as group. To avoid duplicate DMs between the same two users, add a deterministic helper `Channel.get_or_create_dm(user_a, user_b)` that computes a canonical hash of the sorted user IDs and stores it in a `dm_key` column with a unique index.

**Endpoints:**

- `POST /api/channels` — create group `{name, member_ids[]}`
- `GET  /api/channels` — list my channels (joined to memberships, ordered by `last_message_at`)
- `POST /api/channels/dm` — `{user_id}` → get-or-create DM
- `POST /api/channels/{id}/members` — add member (group only, requires admin)
- `DELETE /api/channels/{id}/members/{user_id}` — remove
- `POST /api/channels/{id}/read` — `{up_to_message_id}` → updates `last_read_message_id` (used for offline + unread badges)

**Acceptance:** Alice can create a group with Bob and Carol; Alice can open a DM with Bob and re-opening returns the same channel.

---

## Phase 4 — Message history (REST) + the partitioned messages table

This is the most important schema decision. Get it right now.

**Table** (raw SQL migration — Django ORM can't express partitioning natively):

```sql
CREATE TABLE messages (
  id            BIGSERIAL,
  channel_id    UUID        NOT NULL,
  sender_id     UUID        NOT NULL,
  client_msg_id UUID        NOT NULL,
  body          TEXT,
  attachments   JSONB       NOT NULL DEFAULT '[]',
  reply_to_id   BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at     TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE UNIQUE INDEX ux_messages_channel_client
  ON messages (channel_id, client_msg_id);          -- idempotency
CREATE INDEX ix_messages_channel_id_desc
  ON messages (channel_id, id DESC);                -- history pagination

-- monthly partitions, e.g.
CREATE TABLE messages_2026_05 PARTITION OF messages
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
```

Schedule a monthly Celery beat job to pre-create the next 2 partitions; this prevents writes from failing at midnight on the 1st.

**History endpoint** with keyset pagination (cursor on `id`, not OFFSET):

- `GET /api/channels/{id}/messages?before=<id>&limit=50` → `[messages newest→oldest]`, plus `next_cursor`.
- Permission check: requester must be a member of the channel.

**Acceptance:** History returns in <50 ms for a channel with 1M messages because the index `(channel_id, id DESC)` is hit. Partition pruning kicks in when the cursor narrows the time range.

---

## Phase 5 — The WebSocket pipeline (delivery guarantee #1: persistence + ack)

This is the heart of the system.

**Connection lifecycle (`ChatConsumer` in `apps/chat/consumers.py`):**

1. `connect`: reject if `scope["user"].is_anonymous`. Look up all the user's channel memberships → for each `channel_id`, `await self.channel_layer.group_add(f"chan.{channel_id}", self.channel_name)`. Also join a personal group `user.{user_id}` (for cross-device sync). Accept the socket.
2. `receive`: dispatch by `type` field.
3. `disconnect`: discard from all groups; update presence (Phase 7).

**Client → Server envelope:**

```json
{
  "type": "message.send",
  "channel_id": "…",
  "client_msg_id": "uuid-v4-from-client",
  "body": "hello",
  "attachments": [],
  "reply_to_id": null
}
```

**Server-side handler — exact order matters:**

1. Validate membership in `channel_id`.
2. Attempt insert into `messages`. Because of `UNIQUE(channel_id, client_msg_id)`, a retry from the client of the same envelope returns the existing row instead of creating a duplicate. Use `INSERT … ON CONFLICT (channel_id, client_msg_id) DO UPDATE SET client_msg_id = EXCLUDED.client_msg_id RETURNING id, created_at`.
3. **Ack the sender first**, then fan out. This is what makes "never silently lost" true — the client only removes the message from its retry queue after seeing the ack with its `client_msg_id`:

   ```json
   { "type": "message.ack", "client_msg_id": "…", "server_id": 123456, "created_at": "…" }
   ```

4. `await self.channel_layer.group_send(f"chan.{channel_id}", {"type": "chat.message", "payload": {…}})` — this fans out via Redis to every Channels worker process that has subscribers in this channel, regardless of which pod they're on. That's how horizontal scaling works without sticky sessions.
5. Enqueue a Celery task for offline fan-out: for every member who is not currently connected, push notification (mobile) or rely purely on `memberships.last_read_message_id` + history catch-up on reconnect (web). The latter is cheaper and is what we use in v1.

**Client-side retry queue (Angular):**

- Outbound messages go into an IndexedDB queue with status `pending`.
- On WS open, drain the queue: send each. Mark `acked` when the matching `message.ack` arrives.
- On WS close: stop draining; reconnect with exponential backoff; resume.

**Acceptance:** Kill the WS mid-send → on reconnect, the same message is resent → server returns the same `server_id` (idempotent) → no duplicate in DB, no lost message.

---

## Phase 6 — Receipts: delivered & read (delivery guarantee #2)

Table `message_receipts(message_id, user_id, delivered_at, read_at, PK(message_id, user_id))`.

**Client emits two new envelopes:**

```json
{ "type": "message.delivered", "channel_id": "…", "message_ids": [123, 124] }
{ "type": "message.read",      "channel_id": "…", "up_to_message_id": 124 }
```

**Server:**

- `delivered`: upsert `delivered_at = now()` for each message id where the user is a member but not the sender.
- `read`: in one statement, upsert `read_at = now()` for all messages ≤ `up_to_message_id` in that channel for that user that don't have a `read_at` yet, AND set `memberships.last_read_message_id = GREATEST(last_read_message_id, up_to_message_id)`.
- Broadcast a compact event to the channel group so the sender sees the ticks update:

  ```json
  { "type": "receipt.update", "channel_id": "…", "user_id": "…", "delivered_up_to": 124, "read_up_to": 124 }
  ```

**Why this design:** writing one receipt row per (message, user) lets you show per-user read state in groups, but you only INSERT — never UPDATE-then-SELECT — keeping write amplification low. The `last_read_message_id` cursor on the membership row is the cheap query for "unread count" and offline catch-up.

**Acceptance:** Two browser windows, send → tick (sent), recipient window receives → double tick (delivered), recipient scrolls into view → blue (read). Refresh sender — state is preserved.

---

## Phase 7 — Presence & typing indicators

Use Redis directly (don't store presence in Postgres — too hot).

**Presence model:**

- Each open WS connection writes a heartbeat: `ZADD presence:user:<user_id> <unix_ts> <connection_id>` every 25 s.
- `disconnect` removes the member: `ZREM presence:user:<user_id> <connection_id>`.
- A user is "online" iff `ZCARD presence:user:<user_id>` after `ZREMRANGEBYSCORE … 0 (now-60s)` > 0.
- On connect / disconnect, broadcast `presence.update` to a `presence.user.<user_id>` group; clients subscribe to the presence groups of their contacts on connect.

**Typing indicators:**

- Client sends `{ "type": "typing.start", "channel_id": … }` (and `typing.stop`).
- Consumer just `group_send`s to the channel group; **do not persist**. Add a small server-side rate limit (one event per 2 s per user per channel) to avoid flooding.

**Acceptance:** Open two clients; one starts typing → other sees indicator within 200 ms; closing tab → presence flips to offline within 60 s.

---

## Phase 8 — Offline storage & reconnect replay

The whole point of the partitioned `messages` table + `last_read_message_id` cursor is that offline storage is just history pagination from a cursor. No per-user inbox copies.

**Reconnect protocol:**

1. Client opens WS with `?token=…` and, in the first message, sends:

   ```json
   { "type": "sync.hello", "cursors": [
       { "channel_id": "C1", "last_seen_server_id": 12300 },
       { "channel_id": "C2", "last_seen_server_id": 9981  }
   ]}
   ```

2. Server, for each entry: `SELECT … FROM messages WHERE channel_id=? AND id > ? ORDER BY id LIMIT 500`. If there are >500, return what fits and a `more: true` flag so the client follows up with REST `/messages?after=…`.
3. Server sends a `sync.batch` envelope per channel, then `sync.done`.
4. After `sync.done`, the client drains its outbound retry queue (Phase 5).

**Push notifications for truly offline users (mobile / closed tab):**

- A Celery task triggered from the message handler iterates the channel's memberships, skips users currently in the channel's Channels group (check via Redis), and for the rest looks up `devices` rows and pushes via APNS/FCM. (Out of scope for v1 if you don't have mobile.)

**Acceptance:** Disconnect for 10 minutes while others send 200 messages → on reconnect the client receives all 200 in order, exactly once, then transitions to live mode.

---

## Phase 9 — Media attachments

1. `POST /api/uploads/presign` → server returns `{ url, fields, key }`. Server stores nothing yet.
2. Client `PUT`s the file directly to S3/MinIO using the presigned URL. Django CPU is untouched.
3. Client sends a `message.send` with `attachments: [{ key, mime, size, w, h }]`.
4. On insert, server validates that `key` matches an expected prefix (`u/{user_id}/…`) so users can't claim other people's uploads.
5. Celery task generates thumbnails for images; result keys appended to the `attachments` JSON. Broadcast a `message.update` event so clients swap to the thumb URL.
6. In production, front MinIO/S3 with a CDN (CloudFront / Cloudflare) and serve `S3_PUBLIC_BASE_URL` from the CDN domain.

**Acceptance:** Drag-and-drop a 5 MB image, send arrives within 500 ms with the original key, thumbnail appears moments later via the update event.

---

## Phase 10 — Angular wiring

Folder structure under `src/app/`:

```
core/
  auth.service.ts        ← login/register/refresh, stores JWT
  auth.interceptor.ts    ← attaches Bearer for HTTP
  auth.guard.ts
  api.service.ts         ← HttpClient base
realtime/
  ws.service.ts          ← single WebSocket, reconnect w/ backoff, envelope router
  outbox.service.ts      ← IndexedDB queue for pending sends (idb library)
features/
  channels/
    channel-list.component.ts
    channel.store.ts     ← signals: channels, unread, last_message
  chat/
    chat-view.component.ts
    message.store.ts     ← signals: messages by channel, receipts
    typing.directive.ts
  presence/
    presence.service.ts
shared/
  ui/...                 ← Tailwind components: Avatar, MessageBubble, etc.
```

**Implementation order inside the frontend:**

1. Auth pages + interceptor + guarded `/app` route.
2. `WsService`: single socket, parses by `type`, exposes RxJS subjects per event type. Reconnect with exponential backoff (1s, 2s, 4s, capped at 30s). On `open`, emit `sync.hello` from `MessageStore` cursors.
3. `ChannelListComponent`: calls `GET /api/channels`, subscribes to `message.new` and `receipt.update` to bump previews.
4. `ChatViewComponent`: lazy-loads history with keyset pagination on scroll-up; appends new messages via WS; sends via `OutboxService` (so even an offline send is visible immediately with a "clock" icon, then becomes a single tick on ack).
5. Typing indicator + presence dot via `presence.update` and `typing.*`.
6. File picker → presigned PUT → `message.send` with attachments.

**Acceptance:** Two browsers, two users, side-by-side: send 1:1, send group, see typing, see ticks, refresh restores everything, network drop and recover replays correctly.

---

## Phase 11 — Horizontal scale & hardening

What you change to go from 1 box to N:

1. Run `daphne` (or `uvicorn` + `gunicorn -k uvicorn.workers.UvicornWorker`) behind a load balancer. No sticky sessions needed because Channels uses Redis groups for fan-out.
2. Postgres: enable WAL replication to a read replica; route `GET /api/channels/{id}/messages?before=…` to the replica (DRF mixin choosing the db). Writes (messages, receipts) go to the primary.
3. Redis: start with a single instance for the channel layer; move to Redis Cluster once you outgrow ~50k concurrent sockets per node. Channels supports a sharded layer.
4. Outbox → Kafka (optional upgrade): instead of `group_send` directly, INSERT into an `outbox` table inside the same DB transaction as `messages`, then a small outbox dispatcher process tails it (logical replication or a `WHERE id > cursor` loop) and publishes to Kafka topics partitioned by `channel_id`. Channels workers subscribe and `group_send`. This buys you exactly-once persistence + at-least-once delivery with replayability, which is the "Kafka path" the spec mentions.
5. Backpressure: cap per-connection inbound rate (10 msg/s default, burst 20) in the consumer; close with code 4290 if exceeded.
6. Idempotency at the HTTP edge too: `POST /api/channels` accepts `Idempotency-Key`.
7. Migrations: add `pg_repack` to rotate partitions and a beat job to detach old partitions to a cold store after N months.

**SLO targets (verify with k6 or Locust + websocket plugin):**

- p95 send→ack < 80 ms within a region.
- p95 send→receive (other client) < 150 ms.
- Loss rate (no ack received within 30 s after final retry) = 0 across a 1 M-message run.

---

## Phase 12 — Observability & ops

- **Logging:** structured JSON logs; one log line per message with `channel_id`, `server_id`, `client_msg_id`, `latency_ms` for the send path.
- **Metrics (Prometheus):**
  - `ws_connected_total` gauge per pod
  - `messages_persisted_total`, `messages_fanout_total` counters
  - `send_to_ack_seconds` histogram
  - `redis_groups` gauge
- **Tracing:** OpenTelemetry around `receive` → `INSERT` → `group_send` so you can see broker hops.
- **Health endpoints:** `/healthz` (process), `/readyz` (db + redis pingable).
- **Runbooks:** what to do when Redis is down (sockets stay open but no fan-out — degrade to "polling history" mode in the client), when Postgres replica lags, when an entire AZ drops.

---

## Suggested build order

| Week | Deliverable |
|---|---|
| 1 | Phases 0–2: compose up, auth working, WS handshake authenticates |
| 2 | Phases 3–4: channels, memberships, partitioned messages, history endpoint |
| 3 | Phase 5: send / ack / fan-out with idempotency — the system's core is real |
| 4 | Phases 6 + 7: receipts, presence, typing |
| 5 | Phases 8 + 9: reconnect / replay, media uploads |
| 6 | Phase 10: Angular UI end-to-end |
| 7 | Phases 11 + 12: scale knobs, metrics, load test, polish |
