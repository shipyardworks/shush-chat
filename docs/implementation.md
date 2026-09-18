# Shush — what is actually implemented

> `plan.md` is the plan. **This file is the record of what was built**, where it diverged, and
> why. Where the two disagree, this one is current.
>
> Every claim here is backed by a command in `README.md` §8 that passes.

**Status: all eight phases complete**, plus three rounds of work that came after the plan was
written: a platform split, a client rewrite, and feature work beyond the original phase 8 scope
(message interactions, per-friend unread counts, unfriending, shared custom interests, closing
a real gap in how a conversation ends, and one open stranger conversation at a time).
Outstanding: the benchmark on dedicated hardware and the recorded demo (`deploy.md` §3 and §4),
both of which need a machine that is not this laptop.

---

## Phases

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
| 8 — Benchmark, README, demo | eight-section README, numbers traced to committed runs | partial — see below |

**Phase 8 is partial by design.** The README is complete and every number in it traces to raw
output in `bench/results/`. What is missing is the run on resized hardware with the load
generator on a separate instance, and the recorded demo. The README says so rather than
presenting laptop figures as a headline number.

## Test surface

| Suite | Count | Notes |
| ----- | ----- | ----- |
| Integration (`api`) | 187 | Real Postgres, Redis, Redpanda, Elasticsearch, MinIO via Testcontainers. Nothing mocked |
| Unit (`api`) | 9 | Pure logic only |
| Browser (`web`, Playwright) | 51 | Journey, session, setup, layout and interactions specs, against a stack that is already running |
| Harness self-tests (`bench`) | 17 | Each invariant fed a violating stream, asserted to report it |
| Isolation (`platform`) | 5 checks | Cross-tenant access attempted with real credentials |

`./mvnw clean verify` no longer drives a browser — that moved to `web`'s Playwright suite when the
client left `api/` (see below). The two counts do not overlap.

---

## Divergences from `plan.md`

Everything below is a deliberate departure, with the reason.

### Infrastructure moved to separate repositories

`plan.md` §4 puts `compose.yaml`, `compose.replicas.yaml`, `compose.observability.yaml` and
`infra/` in this repo. They are gone. Shared services now live in
[`platform`](https://github.com/shipyardworks/platform) and
[`observability`](https://github.com/shipyardworks/observability), because
this stopped being the only app that will run on the box. This repo keeps
`compose.platform.yaml`: three stateless replicas, the frontend container, and nothing else.

**This knowingly gives up R7** (`aim.md` §2): a reviewer can no longer clone this repo alone and
run it with one command. That was the owner's call, taken explicitly. The replacement is three
repos and a documented order in the platform README.

### The client became a Next.js app, not the single file `aim.md` called correct

`aim.md` §1.3 names "a deliberately plain single-page test client" as the correct trade for this
project's aim, and `plan.md` §5 (Phase 7) specced `web/index.html`: one file, no build step, no
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

### Reactions and deletes bypass Redpanda by design

`plan.md` does not cover message interactions; they were added afterward, and deliberately do
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

`plan.md` §2.2 allowed `pending` / `accepted` / `expired`. That conflates "nobody replied" with
"someone said no", and the purge rule has to tell them apart. Added in migration `V5`.

### The descending index on `(conversation_id, seq)` was not created

`plan.md` §2.2 lists both a unique constraint and a descending index. A btree scans backwards as
cheaply as forwards, so the second would duplicate the first's index at the cost of an extra
write per message.

### `/api/health` is liveness; readiness is a separate endpoint

`plan.md` §5 asks only for a health endpoint. One endpoint doing both was actively harmful: under
chaos-run load the container probe timed out on dependency checks and declared a healthy node
dead. Liveness now performs no I/O. Readiness checks Postgres and Redis, and deliberately not
Kafka or Elasticsearch — a broker or search blip must not take every replica out of rotation.

### The writer never drops a record

`plan.md` does not specify error handling for the consumer. Spring Kafka's default retries ten
times and then **skips the record** — silent message loss under database pressure, in the one
system whose central claim is that nothing is lost. The writer now retries indefinitely, so a
persistent failure stalls that partition instead.

### A new match ends the stranger conversation it replaces

`pre-plan.md` §3 says a conversation is with one person at a time, and nothing enforced it: every
match left the previous one `active`, so the chat list filled with threads that still took
messages, and one side could keep typing into a conversation the other had long since moved on
from. `ConversationService#createMatched` (matching and invite links both go through it) now ends
every open stranger conversation either person has, in the same transaction that creates the new
one, and tells whoever was left behind with the same `left` frame Leave sends, after commit. Friend
conversations are `kept`, never `active`, and are untouched.

Migration `V10` applies the same rule to conversations already stuck open: an active stranger
conversation ends if either of its people has a newer conversation. It changes `state` and
`ended_at` only; nothing is deleted.

Opening a friend does **not** end a live stranger conversation, although `pre-plan.md` §3 says it
should. That rule was not asked for here, and ending someone's conversation because a row in the
sidebar was clicked is not a change to make in passing.

### The theme is a folder, not a block at the top of a stylesheet

`web/theme/tokens.css` holds every colour, gradient, shadow and scrim; `web/theme/components.css`
holds the shared controls (`btn`, `btn-primary`, `btn-icon`, `field`, `panel`, `badge`, the
searching state). Components read `var(--…)` and write no literal colours. The cyan shield and
the purple-to-cyan gradient on the save prompt were exactly what that rule exists to stop.

### `docs/SCHEMA.md` is generated

Anticipated by `plan.md` §2.1 and now real: written by `SchemaDocIT` on every `./mvnw verify`,
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

**32 needs `platform` too.** The fix is a PUT-only `/shush-media/` route on the app's own origin
(`platform/edge/nginx/conf.d/shush.conf`, with MinIO joining the edge network under the alias
`syamdev-minio`), and `SHUSH_S3_PUBLIC_ENDPOINT` set to the site's own URL. The bytes still
never touch the API; nginx forwards them to MinIO with the signed `Host` unchanged.

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
  cors/          allowed-origin table, re-read every 15s; decides HTTP CORS and the websocket handshake
  common/        AfterCommit — run an action after the surrounding transaction, or now if there isn't one
  config/        security, Kafka, Redis, storage, node identity

web/
  theme/         tokens.css (every colour) and components.css (the shared controls)
  app/           landing page (server component) and the chat page
  components/    Sidebar, ChatPanel, MessageBubble, message actions, attachment preview,
                 camera capture, emoji picker, requests menu, theme toggle
  lib/           useShush — the websocket client and all client-side state
  tests/         Playwright: journey, session, layout, interactions
```

`bench/` is a standalone harness sharing **no code** with `api/`, so a bug in a shared helper
cannot cancel itself out across both sides.
