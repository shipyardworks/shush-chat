# Shush — what is actually implemented

**This is the record of what was built**, how each mechanism works, where it departed from the
original plan, and every bug the tests found. Where this file and any other disagree, this one
is current.

[`README.md`](README.md) is the map · [`aim.md`](aim.md) is why and what · [`SCHEMA.md`](SCHEMA.md)
is the live schema · [`deploy.md`](deploy.md) is the box.

**Status: all eight phases complete**, plus a platform split, a client rewrite, and feature work
beyond the original scope (message interactions, per-friend unread counts, unfriending, shared
custom interests, one open stranger conversation at a time, socket reconnection). Outstanding:
the benchmark on dedicated hardware and the recorded demo — both need a machine that is not this
laptop.

Every claim here is backed by a command in the root [`README.md`](../README.md) §8 that passes.

---

## Phase history

The plan ran in eight phases, each ending in a command that passed or failed with no human
judgement involved. Kept as a record; there is nothing left to do in it.

| Phase | Exit criterion | State |
| ----- | -------------- | ----- |
| 0 — Spike and viability gate | `./mvnw clean verify`, `/api/health`, WebSocket echo test | passed |
| 1 — Identity, domain, single-node chat | auth, names, history, 1,000 concurrent name allocations | passed |
| 2 — Ordering guarantee + harness v1 | harness exits 0 on 50×200 messages | passed |
| 3 — Horizontal scale + harness v2 | `--assert-multinode` across 3 replicas | passed |
| 4 — Chaos and correctness | replica killed mid-send, invariants hold | passed |
| 5 — Presence, typing, receipts, unread, signup | TTL expiry, unread reset, signup preserves identity | passed |
| 6 — Matching, friends, invites, blocks | 100× concurrent-claim test, retention jobs | passed |
| 7 — Media and the test client | media flow + real-browser journey | passed |
| 8 — Benchmark, README, demo | eight-section README, numbers traced to committed runs | partial |

**Phase 8 is partial by design.** The README is complete and every number in it traces to raw
output in `bench/results/`. What is missing is the run on resized hardware with the load
generator on a separate instance, and the recorded demo. The README says so rather than
presenting laptop figures as a headline number.

The correctness harness was built in phase 2 and hardened in phases 3 and 4 — deliberately
before any product feature, because it is the highest-value artifact and the easiest to skip
under time pressure.

## Test surface

| Suite | Count | Notes |
| ----- | ----- | ----- |
| Integration (`api`) | 190 | Real Postgres, Redis, Redpanda, Elasticsearch, MinIO via Testcontainers. Nothing mocked |
| Unit (`api`) | 9 | Pure logic only |
| Browser (`web`, Playwright) | 89 | Journey, session, setup, layout, interactions and connection specs, against a stack that is already running |
| Harness self-tests (`bench`) | 17 | Each invariant fed a violating stream, asserted to report it |
| Isolation (`platform`) | 5 checks | Cross-tenant access attempted with real credentials |

`./mvnw clean verify` no longer drives a browser — that moved to `web`'s Playwright suite when the
client left `api/` (see below). The two counts do not overlap.

Rules that hold across all of it: **no mocked broker, ever** · no `Thread.sleep` in tests, use
Awaitility · every bug fixed gets a regression test first · TTLs are shortened in tests so
expiry is observed rather than assumed.

---

## Data model

[`SCHEMA.md`](SCHEMA.md) is generated from a real Postgres after every migration and is the
truth. This is the shape and the reasoning.

| Table | Holds | Worth knowing |
| ----- | ----- | ------------- |
| `users` | identity, `display_name`, optional `email`/`password_hash` | Signing up sets the email on the **existing** row. Nothing is migrated — that is the whole point |
| `device_tokens` | `sha256` of the opaque browser token | The only thing connecting an anonymous account to a browser |
| `interests`, `user_interests` | the tag vocabulary and who selected what | `interests.id` is an identity column, not hand-seeded: a tag typed at 3am has no number to bring with it |
| `conversations` | `kind` (stranger\|friend), `state` (active\|ended\|kept), `matched_on`, `last_seq`, `purge_after` | `last_seq` is the monotonic sequence source, bumped by the writer consumer alone |
| `conversation_participants` | `read_cursor_seq`, `unread_count`, `left_at` | Counters are maintained, never `COUNT(*)` at read time |
| `messages` | `seq`, `kind`, `body`, `media_key`, `client_msg_id` | `unique (conversation_id, seq)` and `unique (conversation_id, sender_id, client_msg_id)` — the ordering and dedup guarantees are **database** constraints |
| `friend_requests` | `pending` \| `accepted` \| `declined` \| `expired`, 7-day expiry | `declined` was added in `V5`; see the divergence below |
| `friendships` | one row per pair, `user_a_id` the lexically smaller uuid | Ordered by Postgres byte order, not `UUID.compareTo` — bug 6 |
| `blocks`, `reports` | | Reports are recorded, not acted on |
| `media_objects` | `pending` \| `confirmed`, `expires_at` | `expires_at` is stamped at upload, so a retention change governs the next upload only |
| `invite_links` | short code, owner, expiry | |
| `cors_origins` | allowed origins, re-read every 15s | `V6`; an empty table permits no cross-origin browser call at all |

Retention, as actually enforced by the five sweeps:

| Row | Deleted when |
| --- | --- |
| `conversations` | `purge_after` reached **and the conversation has no messages** — the plan deleted every unkept stranger conversation; the owner asked for history of everything, so only a matched pair who never spoke is reaped |
| `friend_requests` pending | `expires_at` reached → `expired`; the conversation goes back on the purge clock |
| `media_objects` | `expires_at` reached (30d, both tiers — see the divergence), or `pending` for over an hour |
| `users` anonymous, no friendships | 30 days after `last_seen_at` |
| `unread_count` | never deleted; recomputed nightly against `read_cursor_seq` |

---

## Mechanisms

Numbered as in the original plan, because code comments cite these numbers. Each describes what
the system does now.

### 3.1 Message ordering — the core claim

1. Client sends over the socket: `{type:"send", conversationId, clientMsgId, kind, body|mediaKey}`.
2. The receiving node validates membership and **produces to Redpanda**, `key = conversationId`,
   `acks=all`, idempotent producer on. It does **not** write to Postgres.
3. The node acks the sender immediately: `{type:"ack", clientMsgId, status:"sent"}`.
4. Consumer group `chat-writer` consumes. One conversation → one partition → one consumer.
5. In one transaction: bump `conversations.last_seq`; insert the message
   `ON CONFLICT (conversation_id, sender_id, client_msg_id) DO NOTHING` — zero rows means a
   duplicate, so skip the fanout and roll back the sequence bump; increment `unread_count` for
   the recipient.
6. The consumer publishes the persisted message to Redis channel `user:{id}` for both parties.
7. Whichever node holds that socket writes the frame.

**Why produce-then-consume rather than write-then-publish:** a dual write to two systems cannot
be made atomic without an outbox. Making the log the write-ahead log and the consumer the only
writer removes the dual write entirely. Rejected alternative: write to Postgres first, then
produce — loses ordering under concurrent producers and can drop the produce after commit.

Topic `chat.messages`, **12 partitions**, replication 1, 7-day retention. Listener concurrency
is 4 per replica (12 ÷ 3), not the single-node default of 12 — otherwise the group has 36
members for 12 partitions and every rebalance shuffles all of them.

### 3.2 Deduplication

`clientMsgId` is a client-generated UUID, stable across retries of one logical send. The unique
constraint is the enforcement point; `ON CONFLICT DO NOTHING` plus a row count is the detection.
Clients additionally drop repeats of `(conversationId, seq)` they have already seen, because
Redis pub/sub can redeliver on reconnect.

### 3.3 Cross-node fanout

Subscribe to Redis channel `user:{userId}` on connect, unsubscribe on disconnect. Local registry
is a `ConcurrentHashMap<UUID, Set<WebSocketSession>>` — a user may have several tabs. **Fanout is
always via Redis**, even same-node: one path, so same-node cannot silently work while cross-node
is broken. Delivery per user is ordered through a single-threaded executor per session — the
container otherwise dispatches each frame on its own thread and reorders under load (bug 2).

**Backpressure:** a session more than 1 MB behind is closed with a policy violation. A client
that cannot keep up reconnects and re-syncs from history rather than being buffered indefinitely.

### 3.4 Presence and typing

| Key | Value | TTL |
| --- | --- | --- |
| `presence:{userId}` | nodeId | 45 s, refreshed by a 15 s heartbeat |
| `typing:{convId}:{userId}` | `1` | 5 s |

Online means the key exists; last-seen falls back to `users.last_seen_at`. Typing is throttled
client-side to one event per 3 s and the server rejects more. Graceful disconnect deletes the
key immediately; the TTL covers crashes. Friends' online status is a single `MGET`.

### 3.5 Unread counts and read receipts

Counters are maintained by the writer consumer, never computed at read time. `{type:"read",
conversationId, seq}` sets `read_cursor_seq = max(current, seq)`, zeroes the counter and
publishes a read event to the other participant. A nightly job recomputes from `messages` versus
the cursor — a deliberate eventual-consistency trade, and the counter genuinely drifts when a
read lands mid-conversation.

A client acknowledges a read **only while the conversation is on screen**; acknowledging from a
hidden view both lies to the sender and zeroes your own unread count (bug 19).

### 3.6 Matching

State in Redis, scoring in Elasticsearch.

1. `{type:"find", interests:[...], patience: 5|10|0}` (0 = indefinite).
2. The user enters the Redis sorted set `matchpool` (score = enqueue time) and the ES `waiting`
   index.
3. The server queries ES for the best-overlapping waiting user, excluding self, blocked pairs
   and existing friends.
4. Both are **claimed atomically** by a Redis Lua script that removes both ids only if both are
   still present. The loser of a race retries. (Tested 100× concurrently: two matchers never
   claim the same third user.)
5. On success: create the conversation, delete both from `waiting`, push `matched` to both.
6. Otherwise wait; a 500 ms tick retries.
7. When patience elapses, match the oldest waiting user regardless of interests,
   `matched_on = null`, and the header says so.

Ranking is BM25 over tag terms — it does not weight rare interests above common ones. A
disconnected user is dropped from the pool, which is why the client re-sends a live search on
reconnect.

### 3.7 Media

`POST /api/media/upload-url` validates MIME against the image allowlist, size ≤ 5 MB, and
membership; inserts a `pending` row; returns a presigned PUT valid 5 minutes for
`media/{convId}/{uuid}`. The client PUTs **directly to storage** — bytes never touch the API.
The writer consumer issues a HEAD before accepting the message: missing → rejected, present →
`confirmed` with the real size. Reads go through `GET /api/media/**`, which authorises on
conversation membership and 302s to a presigned GET.

In the deployed stack both directions travel through nginx's `/shush-media/` route on the app's
own origin, because SigV4 signs the `Host` header and a URL signed for `minio:9000` is
unreachable from any browser (bugs 32, 33).

### 3.8 Identity and auth

- **Anonymous:** `POST /api/auth/anonymous` → a 32-byte opaque token (only `sha256` stored), a
  generated name, `{token, jwt, user}`. The token lives in `localStorage`.
- **Return visit:** `POST /api/auth/device {token}` → a new JWT.
- **Signup:** `POST /api/auth/signup` with a valid JWT sets email, password hash and
  `is_anonymous = false` on the existing row.
- **Login:** `POST /api/auth/login` → JWT. **Sign-out** deletes the device token; the JWT itself
  stays valid until it expires.
- JWT is HS256, 24 h, claims `sub` and `anon`, secret from the environment with no default.
- The WebSocket carries the JWT in the connect query string, validated before the session opens.

### 3.9 Name allocation

Two curated lists of ~200 words in `api/src/main/resources/names/`. Generate `Adjective Noun`,
insert against the unique index, retry up to five times on conflict, then append a number.
Shuffling is rate-limited to roughly 1/second by a Redis token bucket. Custom names require a
saved account; they are validated for length and uniqueness by the same index.

Shuffling lives in the profile dialog rather than the pre-match screen — see the root README's
Open Choices.

### 3.10 Scheduled jobs

Five sweeps, each wrapped in `SET lock:{job} {nodeId} NX PX {lease}`: if the lock is held, skip
this tick. **Never queue, never overlap.**

| Job | Interval | Action |
| --- | --- | --- |
| `purge-conversations` | 5 min | Delete conversations past `purge_after` **with no messages** |
| `expire-friend-requests` | 15 min | `pending` past `expires_at` → `expired` |
| `purge-media` | 1 h | Objects past `expires_at`, and `pending` older than 1 h |
| `purge-anonymous-users` | 24 h | Anonymous, no friendships, `last_seen_at` > 30 d |
| `reconcile-unread` | 24 h | Recompute `unread_count` against the read cursor |

Lease is 5 minutes: longer than any sweep should take, short enough that a node dying mid-job
does not hold the lock for long.

---

## Divergences from the plan

Everything below is a deliberate departure from what the original plan (the phases above,
and the mechanisms in the section before them) laid down, with the reason. Product behaviour
is settled in [`aim.md`](aim.md) §Product; where the build departs from *that*, it says so here
and this file wins.

### Infrastructure moved to separate repositories

The plan put `compose.yaml`, `compose.replicas.yaml`, `compose.observability.yaml` and
`infra/` in this repo. They are gone. Shared services now live in
[`platform`](https://github.com/shipyardworks/platform) and
[`observability`](https://github.com/shipyardworks/observability), because
this stopped being the only app that will run on the box. This repo keeps
`compose.platform.yaml`: three stateless replicas, the frontend container, and nothing else.

**This knowingly gives up R7** ([`aim.md`](aim.md) §2): a reviewer can no longer clone this repo alone and
run it with one command. That was the owner's call, taken explicitly. The replacement is three
repos and a documented order in the platform README.

### The client became a Next.js app, not the single file the plan called correct

[`aim.md`](aim.md) §1.3 named "a deliberately plain single-page test client" as the correct trade
for this project's aim, and phase 7 specced `web/index.html`: one file, no build step, no
framework. That client did its job through phase 7 and became the ceiling on how the product could look.
The owner reversed the call explicitly: `web/` is now a Next.js app in its own container,
proxied by the shared nginx at `/` with `/api` and `/ws` underneath it, so the browser sees one
origin and pays no CORS cost in the normal path.

**This gives up something concrete, on purpose.** `TestClientJourneyIT` and the Selenium
container went with the file they drove — `./mvnw clean verify` no longer exercises a real
browser. `cd web && npm test` (Playwright) covers the same ground — matching in both directions,
images that actually load, a request visible to its recipient, unread counts, delivery ticks, a
removed friend becoming matchable again — but only against a stack that is already up, which the
Java suite never needed. The landing page stays a server component (real HTML before any
JavaScript runs); everything past it is a live websocket and a token held in `localStorage`
rather than an `httpOnly` cookie, the honest trade for a client-rendered app.

### Custom interests are shared, reversing an earlier choice

A tag typed into "something else you're into" started out client-side only, in `localStorage`,
on the reasoning that matching needs a shared vocabulary and a private tag cannot pair anyone by
construction. That reasoning was sound and drew the wrong conclusion: the fix for "a private tag
can't match anyone" is to stop it being private. `POST /api/interests` now finds or creates a
shared row per tag, deduped by a slugified key so `"Xabc"`, `"xabc"` and `"  xabc  "` become one
interest that two strangers can genuinely be told they share. `Interest.id` moved from a
hand-seeded `smallint` to an identity column for the same reason — a tag typed at 3am has no
number to bring with it.

**Only half of that reversal shipped.** The endpoint was built and the client never called it:
the Next.js rewrite carried the *old* reasoning forward in a comment that said so out loud, kept
every typed tag in `localStorage` under a negative id, and filtered negative ids out of both
`PUT /api/interests/mine` and the `find` frame. So the shared-vocabulary fix existed on the
server and no tag ever reached it. That is bug 34, and it is why this section belongs next to
the bug table rather than on its own: a divergence recorded as done with one end of it missing.
The client now creates the row and selects the id it gets back, a tag saved under an old
negative id claims its shared row on the next load, and the input lowercases as it is typed so
what is on screen is what will be created.

### Reactions and deletes bypass Redpanda by design

The plan does not cover message interactions; they were added afterward, and deliberately do
not go through the log. The write-ahead log exists for things that need a position in the
conversation, a sequence number, and exactly one writer. A reaction has no position, and a
deletion edits a row that already has one — routing either through a topic partitioned by
`conversationId` would buy nothing. `seq` stays dense: deleting a message clears its body rather
than the row, because the ordering harness reads a gap in `seq` as a lost message.

### Names are tenant-prefixed on the platform

On a shared broker and a shared search cluster, a tenant is only granted its own prefix, so:

| | Standalone default | On the platform |
| --- | --- | --- |
| Kafka topic | `chat.messages` | `shush.chat.messages` |
| Consumer group | `chat-writer` | `shush.chat-writer` |
| Search index | `waiting` | `shush-waiting` |

The consumer group was hardcoded in the `@KafkaListener` annotation and could not be namespaced
at all until this change. The guarantee is unchanged; only the names move.

### `friend_requests.status` gained `declined`

The planned schema allowed `pending` / `accepted` / `expired`. That conflates "nobody replied" with
"someone said no", and the purge rule has to tell them apart. Added in migration `V5`.

### The descending index on `(conversation_id, seq)` was not created

The planned schema listed both a unique constraint and a descending index. A btree scans backwards as
cheaply as forwards, so the second would duplicate the first's index at the cost of an extra
write per message.

### `/api/health` is liveness; readiness is a separate endpoint

The plan asked only for a health endpoint. One endpoint doing both was actively harmful: under
chaos-run load the container probe timed out on dependency checks and declared a healthy node
dead. Liveness now performs no I/O. Readiness checks Postgres and Redis, and deliberately not
Kafka or Elasticsearch — a broker or search blip must not take every replica out of rotation.

### The writer never drops a record

The plan does not specify error handling for the consumer. Spring Kafka's default retries ten
times and then **skips the record** — silent message loss under database pressure, in the one
system whose central claim is that nothing is lost. The writer now retries indefinitely, so a
persistent failure stalls that partition instead.

### A new match ends the stranger conversation it replaces

[`aim.md`](aim.md) Product §3 says a conversation is with one person at a time, and nothing enforced it: every
match left the previous one `active`, so the chat list filled with threads that still took
messages, and one side could keep typing into a conversation the other had long since moved on
from. `ConversationService#createMatched` (matching and invite links both go through it) now ends
every open stranger conversation either person has, in the same transaction that creates the new
one, and tells whoever was left behind with the same `left` frame Leave sends, after commit. Friend
conversations are `kept`, never `active`, and are untouched.

Migration `V10` applies the same rule to conversations already stuck open: an active stranger
conversation ends if either of its people has a newer conversation. It changes `state` and
`ended_at` only; nothing is deleted.

Opening a friend does **not** end a live stranger conversation, although Product §3 says it
should. That rule was not asked for here, and ending someone's conversation because a row in the
sidebar was clicked is not a change to make in passing.

### The theme is a folder, not a block at the top of a stylesheet

`web/theme/tokens.css` holds every colour, gradient, shadow and scrim; `web/theme/components.css`
holds the shared controls (`btn`, `btn-primary`, `btn-icon`, `field`, `panel`, `badge`, the
searching state). Components read `var(--…)` and write no literal colours. The cyan shield and
the purple-to-cyan gradient on the save prompt were exactly what that rule exists to stop.

### The phone shell: one drawer control, and a header that gets out of the way

Product §3 settles behaviour, not layout, so none of this contradicts it -- but it is a
visible departure from what the client did before, and the reasoning is worth keeping.

A conversation now owns the whole phone screen. The app header stays hidden while a chat is
open *whether or not the drawer is open*: it used to reappear underneath the drawer, so opening
the chats list looked like the page swapping its own header on the way in. The drawer is
`fixed` and full height rather than `absolute` inside `main`, so it stands in front of that
header instead of starting below it.

One control opens it, from both places, and it is a burger. The chat offered `<`, which
promises to leave a conversation and instead opened a drawer over it; the setup panel offered
its own `<` pointing back at a list it was not inside. Both are gone, and the setup panel is
centred in the screen it used to sit at the top of.

The chat's name bar slides shut while the conversation is scrolled down and returns on the way
up, which is the room that bar was costing on a 390px screen. Three separate faults came out of
that one behaviour (bugs 35, 36, 37), all of them in telling the reader's scrolling apart from
the scrolling the feature itself causes.

Your own name has left the phone header -- the avatar beside it still opens the same profile --
to make room for the burger; `sm` and up keeps the name. The paperclip moved inside the message
box next to the camera, which is that button's width plus a gap handed back to the thing being
typed. And `html, body` now clip horizontally: one element wider than the viewport had been
turning the whole page into a canvas that could be dragged sideways, with the send button off
the right edge of it.

### The socket reconnects, and says so when it has not

The plan specifies the websocket protocol and says nothing about the connection's own
lifecycle, which is how a client that opened exactly one socket and never opened another passed
review for eight phases. Everything real-time in this product rides on that one connection; a
browser closes it for reasons that have nothing to do with the app, and `send()` on a closed
one is a silent no-op.

So: reconnect with a capped backoff, plus `visibilitychange` and `online` as wake signals; queue
anything written while it is down and flush it on the next open; re-send a live search on
reconnect, because the server drops a disconnected user from the wait pool; and render
`#reconnecting` whenever the socket is not up, because the cost of this bug was almost entirely
that nothing on screen ever said anything was wrong. See bug 42.

`tests/connection.spec.ts` covers it, and it severs a real socket rather than emulating offline
-- `context.setOffline` leaves an established websocket open in Chromium, so a test written that
way passes against the unfixed client. Severing the transport while leaving fetch alone is also
the truer model: HTTP working perfectly while the socket is gone is exactly what hid this.

### Find someone left the sidebar

It sat above both tabs whether or not either had anything in them, on the list of people you
have already talked to -- which is a list, not a place to start something new from. The start
screen is a press away from the logo, and an ended conversation already offers its own Find
someone. The cost is named in the README's Open Choices rather than hidden: on a phone, with a
conversation open and the drawer over it, the app header is deliberately hidden, so the route to
the start screen from inside the drawer is gone with the button. Leaving the conversation, or
its ending, still offers it.

### Images are kept for thirty days, anonymous or not

[`aim.md`](aim.md) Product §5 point 4 sets two tiers: 24 hours without an account, 30 days with one, and says
plainly that the difference is a real storage bill rather than an invented restriction. The
reasoning holds and the bill does not exist yet -- nothing here is open to the public, and an
image vanishing overnight costs the owner more today than the bytes do. Both tiers are 30 days,
on the owner's instruction.

Both are `${SHUSH_MEDIA_RETENTION_ANONYMOUS}` / `${SHUSH_MEDIA_RETENTION_SAVED}` rather than
literals, so putting the two-tier rule back is an environment variable and a restart, not an
edit and a rebuild. Product §5 is left as written: it is the settled product, and this is the
record of what was built instead.

The setting alone would not have done it. `expires_at` is stamped onto the row when the image is
uploaded, so the setting only ever governs the *next* upload -- every image already in the
bucket keeps the deadline it was created with, and the sweep goes on honouring it. Migration
`V11` restamps them, from `created_at` rather than `now()` so a picture sent three weeks ago
does not get a fresh month, and only where the new window is longer so it can never shorten
anything. Nothing already swept comes back; those bytes are gone.

Guarded by `RetentionJobsIT#anImageInAnAnonymousConversationSurvivesTheNight`, because nothing
guarded it before: the window was a number in a yaml file no test ever read, driving the one
sweep in this system that deletes a person's content on a timer.

### Friends are matched like anybody else

Matching excluded anyone already in your friends list, which was defensible while the pool was
imagined to be large. It is not: keep two or three people and the matcher starts refusing the
only people who are ever around, and the exclusion was permanent -- once two accounts had kept
each other, nothing could put them together again. Unfriending was the only way out, which is a
strange thing to have to do to somebody you like.

`excludedFor` is now blocks only. The conversation itself is what changes: a matched friend
gets "Already friends" as the subtitle and no ask-to-keep button, because there is nothing left
to ask. The client decides that from the friends list rather than from the flag the thread was
opened with -- a match is not opened from a list, so the flag was false for exactly the case
that needed it.

### A patience window that actually ends

The dial promised an answer in five seconds and governed only *how* we matched: after it
elapsed we stopped holding out for a shared interest and took anyone. With nobody in the pool
that second branch found nothing either and the searcher simply stayed in it, watching "Still
looking" for as long as they cared to. A setting the product cannot honour is worse than not
offering one.

`MatchingService` now gives up: it leaves the pool and sends a new `noMatch` frame, and the
client puts the button back to "Find someone" with "Nobody around. Try again." underneath.
`patience = 0` ("Forever") never gives up, which is the whole point of it.

Two races had to be closed, and both are the same shape -- do not tell somebody nobody is
around when somebody was. Giving up happens only when the pool offered no candidate at all: a
lost claim means somebody *was* there and somebody else got them, so that waits for the next
tick instead. And it is skipped entirely if this user is no longer in the pool, because that
means they were the one claimed and a `matched` frame is already on its way.

### One picker, opened from two places

"Find someone" from an ended thread opened a modal; it was then tried as a band at the top of
the conversation, and that is worse at the only thing it has to do. The band is a second,
differently shaped version of a panel the app already has, so finding someone looked like one
thing from the start screen and another from a finished conversation. It is the modal again --
the same `SetupPanel`, the same 620px panel, the same padding -- and the picker is one thing
with one shape wherever it is opened from.

### A typed interest appears before the server has confirmed it

`addInterest` awaited `POST /api/interests` before putting anything on screen -- the row has to
exist for the tag to be matchable, so the tile waited on a network round trip, and pressing
Enter did nothing visible until it came back. It now goes up immediately under a negative
placeholder id, which is swapped for the real one when it lands and removed if the request
fails. Negative ids were already filtered out of everything sent to the server, so a
placeholder cannot be matched on by accident.

**Two things had to be true for that to be safe, and neither was in the first cut** (bug 44).
The tile is written to `localStorage` the moment it appears, placeholder id and all, so a
reload in the gap does not lose a word that is already on screen and chosen. And a create that
does not finish leaves the tile alone rather than deleting it: navigating away aborts the
request in flight, and reading that abort as "the server refused" is how a reload at the wrong
moment quietly removed somebody's word. Only a 4xx removes it. Anything still holding a
placeholder is claimed on the next load *and* before the next search, so a tag that could not
be created when it was typed gets another go at the one moment it has to be real.

A word typed while a search is running also restarts the search with it: changing what you are
looking for used to change only the screen, leaving the server matching on the list it was
handed when the button was pressed. Taking the last one off stops the search on the server too
-- a searcher the server still holds with nothing on screen saying so is the one who gets
handed to whoever asks next.

### Every line the app says lives in `web/lib/messages.ts`

The pills in a conversation, the search statuses, the request wording and the save-account
warning were written where they were used, and had drifted into three lengths and three
voices. They are one file now, and short: "Asked to keep them. You will hear back only if they
say yes." said in thirteen words what four say. The rule is a sentence that can be read without
stopping -- seven or eight words, because a pill in the middle of a conversation is a caption.

Two later corrections, both from reading the result on a phone. **Nothing says "they".** Every
conversation here is exactly two people, so "they're offline" described a crowd that does not
exist; anything about the other person now takes their name, which is on screen anyway and is
what anyone would say out loud. And **the app uses the words the world already has**: "they
asked to keep you" was this codebase's private term for a friend request, and the line says
that now. The one line left long is the save-account warning, which is the only one that has
to carry a consequence nobody has thought of yet -- the short version read as a slogan.

### The request icon is a person and a list

An envelope with a person inside it was three shapes fighting for eighteen pixels, and read as
a smudge. A person with a badge dot replaced it and was a smaller version of the same problem:
at 18px a mark that size cannot be told from the figure it sits on. It is a person with the
burger beside it -- the glyph that already means "a list of things" in both headers. Asking to
keep someone, having asked, and being asked are still three states of one idea: one figure,
one mark changing, a plus, a tick, a list.

### The way out of a conversation is beside the message box

Leaving was in the header's far corner, then in its near one, and the header is the problem
either way: on a phone it is gone by the time anybody wants out, so ending a conversation meant
scrolling back up to a corner. It sits next to the composer now, where the thumb already is,
and it says **Skip**. "Leave" named what happens to the conversation rather than what anyone
wants; "Switch" was tried next and left people asking what was being switched; Skip is what the
whole category calls this and what it plainly is, on the owner's instruction. A friend's
conversation has nothing to skip and gets the way to a new stranger in the same slot, which on
a phone it had no way to reach at all.

And when the other person has asked to keep you, the button that would ask them becomes the
one that answers -- accepting there clears the header's menu and its count, because the
button, the list and the badge are three readings of one list.

### Being asked is announced by the bar that answers it

A request arriving raised a toast, which was wrong twice over: it covered the conversation,
and it went away again while the button it was about stayed hidden. On a phone the app header
holding the requests badge is hidden while a conversation is open, and the chat header is out
of the way -- so the announcement *is* that header opening itself for three seconds, with
"Accept request" already in it. The pill in the thread names who asked.

Opening is the whole of it. The bar also pulsed the brand colour behind itself while it was
up, which says the same thing a second time and in the visual language of a fault; a header
that was not there a moment ago, carrying a button that was not there either, is already the
loudest thing on the screen. Removed on the owner's instruction.

### The header leaves when the conversation needs the room, not when it is scrolled

The name bar used to watch the direction of a scroll: down and it slid shut, up and it came
back. That is what every phone chat app does and it was wrong here in both directions. A
conversation that had visibly filled the screen kept a header sitting on top of it until
somebody dragged it away, and dragging back up -- which is what you do to read what was just
said -- put the header back over the messages. The room the conversation needs is the thing
that actually changed, so that is what is measured now: a `ResizeObserver` on the scroller and
on the conversation inside it, and the header gives up its ~58px the moment the second is
taller than the first.

Three things stop it flapping, and the first is the one that matters. **The comparison is
always against the room there would be with the header open** -- collapsing hands the list the
header's own height, so measuring the result would say it fits, which would reopen it, which
would take that height away again. Subtracting the header back out asks one question in both
states, so the answer cannot flip between them (this is bug 36 in a new shape; the old fix
discounted the same clamp inside the scroll handler). A request arriving overrides it, because
the bar carrying the answer is no use behind the messages. And the very top of the conversation
overrides it too: there is nothing above to make room for, so the header -- with the burger and
Add friend in it -- is reachable again by scrolling back to the start. That is a fixed point
rather than a direction, which is why it cannot oscillate the way the old rule did.

The message list is two elements now rather than one: a scroller, and the conversation inside
it. A `ResizeObserver` on a scroller reports only the scroller's own height, and the height of
what is in it is the whole question.

### The requests dropdown opens at the corner nearest its button

It hung from its right edge, aligned to the button's right edge -- correct alignment, and the
wrong end of the panel. 320px of dropdown anchored to a button in the top-right corner of a
390px phone puts its far side almost against the opposite edge of the screen, so the thing you
had just tapped ends up as far from the panel as the screen allows. It is placed from its
top-left corner now, under the button's left edge, and clamped into the viewport -- which on a
phone means its right edge rests against the screen edge beside the button. The placement goes
through the same `positionPopover` the message menus use, so there is one set of rules for
"beside the thing that opened you, and on screen", and the panel is measured rather than
assumed: it is laid out first and placed in a layout effect, hidden for the one frame in
between.

### Blocking and unfriending tell the other person

A friendship is one row for two people. Deleting it -- by removing a friend, or by blocking
somebody you had kept, which has always deleted it inside the same transaction -- left the
other client showing a friend row that was no longer true, in the blocking case for somebody
who could no longer reach them at all. It corrected itself on the next full load and not
before.

Both now publish `friendshipEnded` to the other party after commit -- the block only when
there was a friendship to delete -- and the client reloads its lists. It says only that the
friendship ended: which of the two happened is not told, for the same reason a declined
request is silent. The conversation is left open either way -- blocking
is about who can reach you, and ejecting somebody from a thread they are standing in is a
separate decision (it is still in Known Limitations).

### Whether this is a friend is read from the friends list, never from the conversation

`conversations.kind` is set the moment a friendship is made and never unset, and the chat panel
read it to decide whether to offer Add friend. So a conversation with somebody you had since
removed hid the one button that could undo that, offered no way out of itself -- a friend's
thread has no Skip -- and said "Offline" under their name as though nothing had happened. The
sidebar already had this right and said so in a comment (`nonFriendConversations` filters on
the friends list for exactly this reason); the panel had a second copy of the answer that could
disagree with it, and did.

The flag is gone rather than corrected. `isFriendConversation` is now derived, in one place,
from whether this person is in the friends list right now -- which is also what makes the
`friendshipEnded` frame above enough on its own: the other side's buttons come back when their
list reloads, with nothing else to keep in step.

### `docs/SCHEMA.md` is generated

Anticipated by the plan and now real: written by `SchemaDocIT` on every `./mvnw verify`,
by reading a real Postgres after every migration has run. It cannot drift, because it is not
maintained — it is asked.

---

## Bugs the tests and harness found

Each was invisible to code review and would have shipped.

| # | Bug | Found by |
| - | --- | -------- |
| 1 | Name-allocation retry ran inside an aborted transaction, so it could never succeed | ordering test timing |
| 2 | Cross-node delivery reordered under load — the container dispatched each frame on its own thread | chaos harness, 1 conversation in 50 |
| 3 | Two sockets opening in the same millisecond raced the backplane's lazy subscribe; the second user was never subscribed | instrumenting a failing test |
| 4 | Spring Kafka's default error handler silently skipped unwritable records | reading the failure path while diagnosing (2) |
| 5 | No container memory limit, so each replica sized its heap for the whole host and the box swapped | chaos run failing with what looked like message loss |
| 6 | `UUID.compareTo` disagrees with Postgres byte ordering, failing ~half of friend requests at random | friend-request tests, intermittently |
| 7 | `recordSelection` bulk-deleted then re-saved managed entities — broken for every returning visitor | real-browser journey test |
| 8 | `crypto.randomUUID` is undefined outside a secure context, so every send threw over plain HTTP | browser test reaching the app on a non-localhost host |
| 9 | An exception in one frame handler closed the socket, so a bug looked like a network fault | browser test |
| 10 | Any tenant could open the `postgres` maintenance database and read the shared catalogs | `verify-isolation.sh`, first run |
| 11 | SASL was wired into the producer and consumer but not the `KafkaAdmin`, so topic creation failed silently and the broker auto-created `chat.messages` with **one** partition — the partitioning the whole design rests on, quietly not happening | reading `partitions assigned: []` while chasing something else |
| 12 | Friend-request notifications were published *inside* the transaction that created them, so the recipient's client re-read the list and saw nothing | browser test |
| 13 | Images could never render: `<img>` sends no `Authorization` header (401), and the client percent-encoded the key's slashes, which Spring's firewall rejects (400) | browser test asserting the image *loads*, not that a bubble exists |
| 14 | The presigned upload URL was signed for `minio:9000` — a host no browser can resolve | browser test |
| 15 | Single-quoting `.env` values made them shell-safe and broke `./mvnw spring-boot:run`, which reads the same file as `.properties` where a quote is just a character | a numeric port failing to parse |
| 16 | `rpk security user update` rejects `-p`; only `create` takes it. Provisioning passed on a fresh volume and failed on every run after | second `docker compose up` |
| 17 | nginx health-checked itself over `localhost`, which resolves to `::1` first, while nginx listened on IPv4 only — a working edge reported unhealthy | reading `docker ps` |
| 18 | `main` declared `272px 1fr`, and a hidden sidebar leaves the grid rather than collapsing its track, so the landing page rendered squashed against the left edge | a screenshot |
| 19 | The client acknowledged reads from a view that was not on screen — which lies to the sender and zeroes your own unread count | the unread badge never appearing |
| 20 | `now - Long.MIN_VALUE` overflows, so the CORS cache looked permanently fresh and the origin set stayed empty for ever, refusing every cross-origin request with nothing logged | a preflight from an origin that was in the table |
| 21 | nginx forwarded `$host`, which drops the port, so the app compared `localhost:8081` against `localhost`, decided its own frontend was cross-origin, and refused the websocket handshake | the Next.js client failing to connect at all |
| 22 | Leaving a conversation told only the leaver — the other person saw nothing and could still send into a conversation that had already ended | extending the conversation-lifecycle tests |
| 23 | Optimistic rendering had two faults: a sent image had no bubble yet to reconcile the server's echo against, so it was silently dropped for the sender though it arrived fine for the recipient; and whether a bubble already existed was read from a flag set inside a state updater on the same line that needed the answer, so every one of your own text messages rendered twice | a counted assertion, after `toContainText` passed happily against the duplicate |
| 24 | The message menu was positioned inside its row rather than against the button that opened it, and the attachment preview sized a tall image against a grid row that had already stretched to fit it — the last message's menu opened off the bottom of the window, and a tall photo pushed through its own caption box | bounding-box assertions across a tall, a wide, a square and a tiny image |
| 25 | `backdrop-filter` on the header made it the containing block for the requests dropdown's fixed-position backdrop, silently confining the click-outside catcher to a thin strip under the header — clicking anywhere else in the page did nothing | `elementFromPoint` at the sidebar's coordinates |
| 26 | nginx (in `platform`) resolves a proxied hostname once at startup; rebuilding the frontend container left it pointing at a dead IP, and every request came back 502 until nginx was restarted | 502s after a routine rebuild |
| 27 | A match never ended the conversation before it, so old stranger threads stayed open and writable forever — the same pair could be talking in one and locked out of another | two screenshots of the same person's chat list |
| 28 | Typing an interest that was already a tile made a private copy under its own id, so "history" rendered twice, and only one of the two could ever match anyone | a screenshot; now a test that types a tile's name twice |
| 29 | `find` was sent only after the interests saved, so a Stop pressed in that gap reached the server first and the `find` after it — the screen said "not looking" while the server kept that person in the pool, to be matched with whoever searched next | a flaky unrelated test matching with the previous test's user; reproduced by a test that delays the save |
| 30 | A history load that finished after another thread was opened appended its messages to that thread | reading the load path while adding its skeleton |
| 31 | iOS offered its password / card / address AutoFill bar above the message box: it ignores `autocomplete="off"` on an `<input>` it cannot rule out as a form field. It never offers it for a `<textarea>` | a phone screenshot |
| 32 | On the live domain every image upload failed with "could not reach image storage": uploads go from the browser straight to a URL presigned for `SHUSH_S3_PUBLIC_ENDPOINT`, and the platform only ever exposed MinIO on the box's loopback — plain http, unreachable from any phone and blocked under an https page anyway. It had only ever worked on localhost | a phone screenshot on the live site |
| 33 | The route added for 32 was `limit_except PUT`, and a read is a 302 to a presigned **GET** on that same origin -- so every image ever sent came back 403 from nginx and drew "Photo unavailable". Uploads had been working the whole time; the bytes were in the bucket | a phone screenshot, confirmed against `access forbidden by rule` in the nginx error log |
| 34 | A typed interest never reached the server: the client kept it in `localStorage` under a negative id and `find` filtered negative ids out, so searching with only a typed tag sent an *empty* interest list -- which the matcher rejects outright. Two people who had each typed the same word sat on "Looking" for ever and were never candidates for one another, with nothing on either screen saying so | the owner typing the same tag on two phones |
| 35 | The conversation header slid shut when a *message arrived*: following the live end scrolls the list, in the same direction a reader does, and nothing told the two apart | the first assertion of the test written for the header |
| 36 | Collapsing that header gives the message list its height, and a list parked at the bottom has its `scrollTop` clamped by the same amount -- a scroll event the other way, which reopened the header, which shortened the list, which closed it. A flicker that settled nowhere | the same test, measuring height rather than trusting the attribute |
| 37 | Collapsing the padded header directly floored at 29px: a `border-box` element cannot be squeezed below its own padding plus border, so `0fr` left a strip that would not close | measuring the collapsed height instead of asserting the attribute |
| 38 | The four aspect-ratio fixtures were `readFileSync` from an absolute `/tmp` path belonging to the machine the test was written on. The files were never committed, so eight layout tests failed with `ENOENT` on every other clone -- including the next one of this repo | running the suite on this machine for the first time |
| 39 | The swipe test released the strip mid-movement, which hands Chromium a velocity and it flings. What it then measured was the browser's momentum, not the app's hold-off -- it passed only when the machine was loaded enough not to fling, and failed six times out of six run on its own | running that one test by itself |
| 40 | "You both like " with nothing after it: the matched-conversation subtitle resolved ids against the browsable catalogue, which deliberately excludes anything anyone typed | the new matching test asserting the interest is *named*, not just that a chat opened |
| 41 | The check written for 3 could not fail. It looked for elements sticking out past the viewport and skipped any with a clipping ancestor -- and the `overflow-x: hidden` added to `body` in the same change made *every* element on the page have one, so the list was empty by construction | asking it to find a 3000px div, which it did not |
| 42 | **The websocket was opened once and never reopened.** `WebSocket.send()` on a closed socket throws nothing and delivers nothing, so from the first disconnect onward every frame the app wrote -- `find`, `send`, `read`, `typing`, `leave` -- went into the floor, while the screen carried on looking exactly as it does when connected. HTTP kept working throughout, because fetch opens its own connection each time; that is what made it invisible, and what made it look like the matcher. Pressing Find wrote its `user_interests` row over HTTP and then sent the `find` frame nowhere, so the button spun on "Looking" against a server that had never heard of the search | the owner reporting that matching had stopped working at all, then the box: a selection written at 11:14:48 with no matching entry in either the Redis wait pool or the Elasticsearch index -- one half of one press landing and the other half missing |
| 43 | The iOS long-press callout opened on top of the message menu. Holding a bubble is the app's own gesture; Safari's identical gesture selects the word under the finger and raises Copy \| Search with Google over it, and the app's menu is the one that gets dismissed | a phone screenshot, and now a test that reads `user-select` on the bubble and its text |
| 44 | A typed interest was put on screen before the server confirmed it, and only remembered *after*. Worse, navigating away aborts the create in flight and the failure path read that as a refusal and deleted the tag -- so a reload at the wrong moment silently removed a word that was on screen and chosen. It failed only under load, which is exactly when the window is wide | the browser suite, intermittently; then reproduced on demand by holding the create for four seconds and reloading through it |
| 45 | Accepting a request from inside the conversation left the header's badge showing "1". Friends and chats were reloaded; the requests list the badge counts was not | the test written for the new button |
| 46 | Every text field was 15px, so iOS zoomed the page in on focus and never zoomed back -- which is why the header buttons ended up half off the right edge the moment somebody started typing, with nothing about the layout actually wrong | a phone screenshot |
| 47 | A conversation with somebody you had **removed as a friend** still behaved as a friend's: no Add friend, no way out of it, and "Offline" under their name. The panel decided it from `conversations.kind`, which is set when a friendship is made and never unset -- the sidebar read the friends list for the same question and was right | the owner, on the live site |
| 48 | **Blocking or unfriending told only the person who did it.** One row, two people: the server deleted the friendship and published nothing, so the other side went on showing a friend who -- after a block -- could no longer reach them, until something else made that client reload | the owner, reporting that a blocked friend stayed in the list; then a two-browser test that never reloads |
| 49 | `leaving` is a ref, set on unmount to stop a socket being reopened behind a page that has gone, and **never cleared on the way back in**. Mount, unmount, mount again and every `openSocket` returned immediately: an app that renders perfectly, hears nothing, and says only "Reconnecting". React's strict mode does exactly that double-mount, so it was reproducible on the first load of every dev server | trying to drive the app with `next dev` while testing something else |

**49 is 42 again, and 42 is the same shape as 11, 20, 21, 33 and 34.** A silent refusal, found
the same way all of them were -- by asking the running system a question rather than by reading
the code. It never reached production, because React only double-mounts in development and the
container runs a production build; it was one remount away from being bug 42 for real.

**42 is the same shape as 11, 20, 21, 33 and 34, and the worst of them.** Every one of those was
a silent refusal -- a request the system dropped with nothing anywhere saying so. This one was a
silent refusal of *everything real-time at once*, for any session whose socket had ever closed:
a phone locked for a minute, a switch from wifi to mobile data, a replica restarting under a
deploy. The fix is in three parts, and the third is the one that matters most. The socket
reconnects with a capped backoff, and on `visibilitychange` and `online` rather than only on a
timer. Anything written while it is down is queued and flushed on the next open, instead of
being handed to a socket that will swallow it. And the app now *says* it is disconnected, which
is the part that would have turned four days of "matching is broken" into one look at the
screen. A reconnect also re-sends a search that is still on screen, because the server drops a
disconnected user from the wait pool -- coming back without that leaves the button spinning over
a pool nobody is in.

**One thing reported as a bug this round was not one.** Images sent yesterday were gone today.
They were deleted on purpose: in a conversation where neither person had saved an account, media
was kept for 24 hours (Product §5 point 4), and `purged 2 media object(s)` is in the
scheduler's log at the hour it happened. What was wrong was only what the app said about it --
"Photo unavailable", which reads as breakage. An expired image now says "Photo expired": the box
asks the API once, after a failure, and `unknown_media` (404) is the object having been reaped
rather than anything having gone wrong. The window itself was then changed on the owner's
instruction -- see below.

**32 needs `platform` too.** The fix is a `/shush-media/` route on the app's own origin
(`platform/edge/nginx/conf.d/shush.conf`, with MinIO joining the edge network under the alias
`syamdev-minio`), and `SHUSH_S3_PUBLIC_ENDPOINT` set to the site's own URL. The bytes still
never touch the API; nginx forwards them to MinIO with the signed `Host` unchanged. That route
was written PUT-only, which is bug 33.

**33 and 34 are the same shape as 11, 20 and 21.** Each was a silent refusal: a 403 with no log
line the app could see, and a request the client had quietly emptied before sending. Both were
found by asking the running system a question rather than by reading the code that caused them,
and in both cases a test existed that covered the behaviour and was pointed somewhere harmless.
`an image reaches the other person and actually loads` does catch 33 -- but only once
`SHUSH_S3_PUBLIC_ENDPOINT` names the app's own origin the way the deployment does, which is now
the default in `.env.example` rather than a laptop-only shortcut to MinIO's host port.

Four of these are worth separating out, because the tests that "covered" them passed:

- **12 and 13 were both hidden by weak assertions.** The journey test waited for
  `presenceOfElementLocated` on the request button — presence, not visibility — so it passed
  against an element that no recipient could ever see. Nothing asserted that an image *loads*,
  only that a bubble appeared. Both assertions are now the stronger ones.
- **23 was hidden the same way.** `toContainText` passes happily against a duplicate message; the
  assertion is counted now.
- **20 and 21 are the same shape as 11.** Each was a silent refusal with no log line and no
  failing test — a cache that never refreshed, and a port dropped by a proxy. Both were found by
  asking the running system a question, not by reading the code that caused them.
- **11 changed nothing observable.** Ordering still held, dedup still held, the harness still
  passed — on one partition, with eleven of twelve consumers idle. A correctness harness cannot
  catch a scalability property that has silently stopped being exercised.

---
## Where the code lives

```
api/src/main/java/site/syamdev/shush/
  auth/          anonymous identity, device tokens, signup, login, JWT
  user/          names, interests (including custom ones, now shared), profile
  conversation/  lifecycle, participants, history, resume, ending
  message/       producer, chat-writer consumer, sequencing, dedup, reply/react/delete
  realtime/      WebSocket handler, session registry, Redis backplane, ordered delivery
  presence/      presence, typing
  matching/      wait pool, Elasticsearch scoring, atomic Lua claim
  social/        friend requests, friendships (with unfriending), blocks, reports, invites
  media/         presigned upload, HEAD confirmation
  scheduler/     five retention jobs behind a Redis lock
  cors/          allowed-origin table, re-read every 15s; decides HTTP CORS and the handshake
  common/        AfterCommit — run an action after the surrounding transaction, or now if there isn't one
  config/        security, Kafka, Redis, storage, node identity
  resources/db/migration/   Flyway, forward-only, V1..V11

web/
  theme/         tokens.css (every colour) and components.css (the shared controls)
  app/           landing page (server component) and the chat page
  components/    Sidebar, ChatPanel, MessageBubble, message actions, attachment preview,
                 camera capture, emoji picker, requests menu, theme toggle
  lib/           useShush — the websocket client and all client-side state
  tests/         Playwright: journey, session, layout, interactions, connection

bench/           the invariant harness: load generator + assertions + its own tests
compose.platform.yaml   three api replicas and the web container. No infrastructure
```

`bench/` shares **no code** with `api/`, so a bug in a shared helper cannot cancel itself out
across both sides. It speaks only the public HTTP and WebSocket protocol.

Infrastructure is in the sibling `platform` repo (postgres, minio, redis-shush, redpanda,
elasticsearch, nginx) and `observability` (prometheus, grafana). See [`README.md`](README.md)
for the topology and [`deploy.md`](deploy.md) for the commands.

## Code conventions

- Java 21, records for DTOs, sealed interfaces for frame types, **no Lombok**.
- Constructor injection only, never field injection.
- **Package by feature, not by layer** — the tree above.
- All configuration through `application.yml` with env overrides. No secrets in the repo.
- Structured logging; never log message bodies, tokens, emails or media keys.
- Metrics: counters per message produced/consumed/fanned-out, a timer for end-to-end latency,
  a gauge for open connections. Prometheus discovers replicas from Docker labels.
- Dependency versions pinned exactly — no ranges, no `LATEST`.
