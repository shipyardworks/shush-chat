# Shush

Real-time 1:1 chat. Strangers are matched on shared interests, talk, and can keep each other as
friends.

**This is a portfolio and interview artifact, not a product.** Its purpose is to make one claim
and then prove it:

> Strict per-conversation total ordering with effectively-exactly-once delivery, across N
> stateless nodes, verified by an automated harness that asserts zero reordering, zero duplicates
> and zero loss — including while a node is killed mid-run.

Everything else in the system exists to force that problem into the open.

```bash
# 1. shared infrastructure, once
git clone git@github.com:shipyardworks/platform.git && cd platform
cp .env.example .env && ./bootstrap.sh
for s in data streaming search edge; do
  docker compose --env-file .env -f $s/compose.yaml up -d
done

# 2. this app
cd .. && git clone <this repo> && cd shush-chat
cp .env.example .env                      # the shared values must match the platform's
docker compose --env-file .env -f compose.platform.yaml up -d --build
open http://localhost:8081/
```

Details in [§8](#8-running-it).

---

## Contents

1. [The guarantee](#1-the-guarantee)
2. [Architecture](#2-architecture)
3. [The hard problems](#3-the-hard-problems)
4. [Design decisions](#4-design-decisions)
5. [Benchmarks](#5-benchmarks)
6. [The correctness harness](#6-the-correctness-harness)
7. [Known limitations](#7-known-limitations)
8. [Running it](#8-running-it)

Plus [Open Choices](#open-choices) — decisions taken where the specification was silent.

---

## 1. The guarantee

**For any conversation C, there exists one total order over the messages of C, and every observer
sees exactly that order.** Concretely:

1. **Dense sequencing.** Each message carries a `seq` unique within C, and the assigned values are
   exactly `1..n` with no gaps.
2. **Agreement between observers.** Both participants' sockets receive messages in ascending `seq`
   order, and the durable history endpoint returns the same order after any reload.
3. **Exactly-once effect.** A message with a given `clientMsgId` is persisted at most once and
   delivered to each participant at most once, however many times the client retries it or the
   broker redelivers it.
4. **Survives node loss.** All of the above continue to hold while a replica is killed outright,
   mid-conversation, with traffic flowing.

### Preconditions, stated honestly

- **The order is the order the broker accepted the messages in**, not wall-clock send time. There
  is no global clock, and two concurrent senders on different machines have no "true" order to
  recover. What is guaranteed is that *everyone agrees* on the order that was chosen.
- **`chat.messages` must stay keyed by `conversationId`**, and its partition count must not change
  under a live conversation. Adding partitions re-hashes keys, so a conversation could move
  partition while messages for it are still in flight on the old one, and two consumers would then
  be writing it at once.
- **Durability starts at the `sent` ack, not at the send.** A node can die between reading a frame
  from a socket and producing it. That message really is lost, and recovering it is the client's
  job — retransmit the unacked `clientMsgId`, which the dedup constraint makes safe.
- **Delivery, not durability, depends on Redis.** With Redis down, messages are still committed and
  sequenced correctly and history serves them; nothing is pushed to a live socket.

### Where it is enforced

One conversation → one partition (the key) → one consumer thread (the `chat-writer` group) → one
writer. `seq` is claimed with `UPDATE conversations SET last_seq = last_seq + 1 ... RETURNING`, in
the same transaction as the insert, so a rolled-back write releases its number rather than leaving
a gap. Deduplication is the `messages_conversation_sender_client_msg_id_key` unique constraint — a
database guarantee, not application logic.

---

## 2. Architecture

```
                          ┌──────────────────────────────┐
     Browser ── WSS ──────►            nginx             │
                          │   least_conn, no stickiness  │
                          └───┬──────────┬──────────┬────┘
                              │          │          │
                        ┌─────▼───┐ ┌────▼────┐ ┌───▼─────┐
                        │  api-1  │ │  api-2  │ │  api-3  │   Spring Boot 3,
                        │         │ │         │ │         │   virtual threads
                        └──┬───┬──┘ └──┬───┬──┘ └──┬───┬──┘
                produce ───┘   └──sub──┤   └──sub──┤   └── sub
                    │                  │           │
            ┌───────▼────────┐  ┌──────▼───────────▼──────┐
            │    Redpanda    │  │          Redis          │
            │ chat.messages  │  │  pub/sub · presence     │
            │ key=convId     │  │  typing  · match pool   │
            │ 12 partitions  │  │  job locks              │
            └───────┬────────┘  └─────────────────────────┘
                    │ consume (group: chat-writer)
            ┌───────▼────────┐  ┌──────────────┐  ┌──────────────┐
            │   PostgreSQL   │  │Elasticsearch │  │ MinIO  /  S3 │
            │  system of     │  │   matching   │  │    media     │
            │    record      │  └──────────────┘  └──────────────┘
            └────────────────┘
```

**The send path.** A client's frame is *produced* to Redpanda keyed by `conversationId` and acked
`sent`. The `chat-writer` consumer group — the only writer to `messages` — assigns the sequence
number, commits, and publishes to Redis. Whichever node holds a recipient's socket receives it
there and writes it out. The socket handler never inserts, because a controller that writes is the
dual write this design exists to remove.

**Nodes are interchangeable.** A node subscribes to `user:{userId}` on Redis while it holds one of
that user's sockets, so it listens only for the users actually connected to it. Nothing is sticky,
nothing addresses a node, and a client that reconnects usually lands somewhere else.

**Ownership of state.** Postgres is the system of record. Redis holds only derived state that must
not outlive a restart — presence, typing, the match pool, scheduler locks. Elasticsearch holds only
who is waiting. Media lives in object storage and never passes through the API.

---

## 3. The hard problems

### 3.1 Per-conversation ordering under concurrent producers

Two participants send at once from different nodes; every observer must see the same total order.
Solved by making the topic the write-ahead log and the partition key the conversation id, so
ordering is a property of the topology rather than of locking discipline. A dense `seq` is claimed
in the same transaction as the insert.

### 3.2 At-least-once transport, exactly-once effect

Networks drop, clients retry, consumers redeliver. `clientMsgId` is generated by the client and
stable across its retries; the unique constraint is the enforcement point, and `ON CONFLICT DO
NOTHING` with a zero row count is the detection. A duplicate is acked with the original `seq` and
deliberately not delivered a second time.

### 3.3 WebSocket fanout across replicas

User A holds a socket on node 1, user B on node 3, and node 1 has no route to B. Solved with a
Redis pub/sub backplane and a per-node registry that is the last hop only. Same-node delivery takes
the identical path — see [§4.2](#42-no-sticky-sessions) for why the obvious shortcut is a trap.

### 3.4 Presence and typing at keystroke rates

Presence is a Redis key with a TTL, renewed every 15 s and expiring after 45 s: presence asserted
by a key that must be renewed cannot outlive the process renewing it, so a dead node self-corrects
and no cleanup job exists. Typing is throttled at the *server* with a `SET NX` window, not only at
the client — a client with a bug should not be able to melt the datastore.

### 3.5 Media without bytes through the API

Presigned PUT scoped to one key, direct to storage, then a HEAD from the writer before the message
is accepted. The row is written before the bytes exist so an abandoned upload is still findable and
gets swept up, and the size is taken from storage because the client's number was only a claim.

### 3.6 Unread counts without hammering the database

Maintained by the writer, never a `COUNT(*)` at read time. The read cursor only moves forward, so a
slower second device cannot resurrect read messages. A maintained counter drifts, so a nightly job
recomputes it — a deliberate eventual-consistency trade, named rather than hidden.

### 3.7 Interest matching

Term overlap over a controlled vocabulary, scored by Elasticsearch, with the exclusions and the
tie-break on waiting time in the same query. The pair is claimed by a Lua script that removes both
ids only if both are still present, because two matchers finding the same third person is the
expected case and exactly one must win.

---

## 4. Design decisions

### 4.1 Redpanda as the write-ahead log, not a database write followed by a publish

**Chosen.** The message is produced first. A single consumer group is the only writer to Postgres
and also triggers fanout.

**Rejected: write to Postgres, then produce.** A dual write to two systems that cannot be made
atomic. Die between the commit and the produce and the message is durable but never delivered — the
worst failure available, because the sender was already acked. Fixing it properly needs a
transactional outbox plus a relay, which is strictly more machinery than moving the write behind
the log.

**Rejected: write to Postgres only, fan out directly.** Ordering then depends on which node's
transaction commits first — a race between concurrent senders with no arbiter, so two participants
can observe different orders. `SERIALIZABLE` plus a per-conversation advisory lock could recover
it, at the cost of serialising every send on a database lock, and the ordering would still be
invisible to any later consumer.

**What the chosen design costs.** A broker round trip before the `sent` ack. Delivery is
asynchronous relative to the request, so the client needs the two-stage ack to tell durable from
sequenced. And the broker is a hard dependency for sending at all — the system fails closed with
`produce_failed` rather than accepting a message it cannot order.

### 4.2 No sticky sessions

**Chosen.** `least_conn`, no affinity of any kind. Any replica serves any user; authentication is a
stateless JWT and there is no server-side session.

**Rejected: `ip_hash` or a sticky cookie.** The reflex answer, and it does make the immediate
problem disappear. It also means a node dying takes its users' sessions with it, that everyone
behind one corporate NAT pins to one replica, that scaling out does not rebalance existing
connections, and — worst — that the cross-node path is never exercised in normal operation, so it
rots undetected. Stickiness converts a routing problem into an availability problem.

**Rejected: a shared connection registry** (user → node) with nodes forwarding to each other. It
works, and it adds a lookup on the delivery path, a consistency problem after a crash, and
node-to-node addressing — the very thing that makes replicas non-interchangeable.

**Rejected: round-robin.** WebSocket connections are long-lived and disconnect unevenly, so
balancing at assignment time drifts over a long run. `least_conn` tracks what is actually open.

**The cost, honestly.** Every message crosses Redis even when both participants are on the same
node. That is deliberate: a same-node shortcut is an easy optimisation and a bad one, because the
local path is the one that always works in development, so cross-node delivery would break silently
and only surface under a load balancer. One path means a bug is a bug everywhere.

### 4.3 Elasticsearch for matching, not embeddings

**Chosen.** An inverted index over a controlled tag vocabulary, doing the ranking, the exclusions
and the tie-break in one query.

**Rejected: pgvector / ANN search.** Both sides of a match draw from the same fixed tag list, so
there is no semantic gap for vectors to close. It would put an embedding model in the request path
— latency, an external dependency, model drift — to approximate a set intersection that can be
computed exactly.

**Where that flips.** The moment the input stops being a controlled vocabulary: free-text bios,
cross-language matching, or "find users like this user" derived from behaviour. Those are genuine
semantic-similarity problems where an inverted index performs badly, and pgvector becomes the right
answer instead.

### 4.4 Java 21 on virtual threads, not WebFlux

**Chosen.** Spring MVC with `spring.threads.virtual.enabled`, asserted by a test so it cannot be
silently dropped. Blocking-style code, one virtual thread per request, true multi-core parallelism
in one process, and a shared heap so the connection registry and presence cache stay node-local
instead of becoming a network hop.

**Rejected: WebFlux.** Reactive was the old answer to high-concurrency I/O on the JVM and it costs
a great deal in debuggability — stack traces stop being meaningful and every library in the chain
must be non-blocking or the benefit evaporates. Loom gets the same scalability with code that is
readable and profileable. WebFlux would still win for true end-to-end streaming backpressure.

**The honest counterpoint on Go**, since it is the obvious alternative for this workload: cheaper
goroutines, lower memory per connection, faster startup, single-binary deploys, no GC to reason
about. What the JVM bought here was the reference Kafka client, a mature Elasticsearch client, and
a much better profiling story for a project whose deliverable is a measurement.

### 4.5 Per-user ordered delivery — a bug the harness caught

The first three-replica run failed on exactly one invariant: two participants in one conversation
out of fifty disagreed about the order of messages 165 and 166. Sequence numbers were dense and
correct and the database was correct; only the order frames reached the sockets differed.

Spring's `RedisMessageListenerContainer` dispatches each received message to a task executor, so
two frames arriving on one channel raced each other to the socket. Nothing about it was visible on
a single node, where fanout had been a synchronous write from the writer thread. It needed three
replicas, a load balancer and 10,000 messages to appear once.

The fix is two-part: the container delivers on its receiving thread, preserving per-channel receive
order, and the listener hands off to a **chain of tasks per user** rather than a shared pool — so
ordering is guaranteed within a user and nothing is promised between users, which is exactly what
the guarantee claims. A striped thread pool would have been simpler, but one slow socket would then
stall every user sharing its stripe; virtual threads make a chain per connected user cost almost
nothing.

### 4.6 One row per friendship, and the ordering bug inside it

`friendships` stores each pair once with the ids in a fixed order, enforced by a check constraint —
storing both directions makes "are these two friends?" a question with two answers that eventually
disagree.

The first implementation ordered the pair with `UUID.compareTo`, and roughly half of all friend
requests failed with a constraint violation, at random. **Java compares a UUID's halves as signed
longs; Postgres compares the sixteen bytes unsigned.** For any pair differing in the top bit the two
disagree. The database owns the constraint, so the ordering has to match the database.

Worth naming because it is the shape of bug that survives review: the code reads correctly, the test
that would catch it passes half the time, and the failure looks like flakiness.

---

## 5. Benchmarks

Full raw output, hardware and method: [`bench/results/`](bench/results/).

| Mode | Messages | Sockets | Wall clock | End-to-end throughput | Invariants |
| ---- | -------- | ------- | ---------- | --------------------- | ---------- |
| ordering | 10,000 | 100 | 17.8–34.6 s | 289–563 msg/s | all held, 3/3 runs |
| chaos | 25,000 | 100 | 58.3–83.7 s | 299–429 msg/s | all held, 3/3 runs |

**Method.** Three api replicas behind nginx, plus Postgres, Redis, Redpanda, Elasticsearch and
MinIO, brought up from a clean clone with one command. 50 conversations, both participants sending
concurrently, 100 sockets. Chaos mode kills `api-2` outright fifteen seconds in, while sends are
still in flight.

**What these numbers are not.** The load generator runs on the same machine as the system under
test, so they measure the pair together — and the spread between otherwise identical runs shows it.
Chaos throughput is lower because that mode deliberately *paces* its sends over a 40 s window so the
kill lands mid-flight; it is an offered rate, not a ceiling.

**They are evidence that the invariants hold, not a throughput claim.** A credible throughput number
needs dedicated hardware with the load generator on a separate instance in the same availability
zone — otherwise you are measuring the load generator. That run is documented in
[`docs/deploy.md`](docs/deploy.md) §3 and has not been performed yet; the headline figure will be
filled in from it, and nothing in this table will be restated as one.

---

## 6. The correctness harness

`bench/` is a standalone program that shares **no code with `api/`**. It speaks only the public
HTTP and WebSocket protocol, so a bug in a shared serialisation or ordering helper cannot cancel
itself out across both sides.

### What it asserts

**Ordering mode** — both participants sending as fast as the socket allows:

| Invariant | Meaning |
| --------- | ------- |
| no gaps in `seq` | every value `1..n` exactly once; a gap is a lost write, a repeat a double one |
| identical order observed | *arrival* order matches between the two sockets, not just contents |
| no duplicate deliveries | no `clientMsgId` reaches a socket twice |
| nothing lost | sent == observed == persisted, and the persisted history is `1..n` in order |

**Chaos mode** — the same, with a replica killed mid-send:

| Invariant | Meaning |
| --------- | ------- |
| no reordering across the kill | neither observer's stream ever goes backwards |
| no duplicate deliveries | retransmission does not become a second message |
| nothing lost | the log holds exactly `1..n` |
| every send in the log once | every acknowledged `clientMsgId` is persisted exactly once |
| resume returns what was missed | a reconnecting client can fetch precisely its gap, in order |
| the kill actually disturbed it | fails if no socket reconnected |

### Why it can be trusted

- **`docker kill`, not `docker stop`.** A SIGKILL gives the process no chance to drain sockets or
  commit offsets. Correctness must not depend on a dying node behaving politely, and a graceful stop
  would quietly test the easy case.
- **Sends are ack-aware.** A message counts as sent only when the server acks it, and unacked ones
  are retransmitted with the *same* `clientMsgId` — so the dedup constraint is genuinely exercised
  rather than assumed. Counting a socket write as a send would report loss that is really the
  client's failure to retry.
- **It has its own tests.** `InvariantsTest` (17 of them) feeds each check a stream that violates it and
  asserts the violation is reported. A harness that cannot fail would make a green run meaningless.
- **Its "did this prove anything" guards are themselves checked.** `--assert-multinode` was run
  against a single node and the chaos mode against an already-dead replica; both correctly fail
  rather than passing vacuously. `--assert-multinode` has already caught a real misconfiguration —
  stale nginx upstreams sending all 100 sockets to one replica.

### And in the build

`./mvnw clean verify` runs 169 integration tests against real Postgres, Redis, Redpanda,
Elasticsearch and MinIO via Testcontainers. **Nothing is mocked, and the broker never will be:**
partition assignment is exactly the behaviour a mock removes, and it is the behaviour the whole
claim rests on. Two of those tests start a *second* full application context against the same
infrastructure to prove cross-node fanout and cross-node matching; two more drive the real client
through two containerised browsers.

---

## 7. Known limitations

**A message read from a socket but not yet produced is lost if that node dies.** The window is
sub-millisecond and a correct client recovers by retransmitting the unacked `clientMsgId`, but the
recovery is the *client's* responsibility. The `sent` ack is the durability boundary; nothing before
it is a promise.

**Ordering is per conversation and nothing more.** No ordering between conversations, and none
between a message and, say, a friend request. Deliberate — a global order means a single partition
and no horizontal scale — but "Alice's message arrived before Bob's" is only meaningful within one
conversation.

**Increasing the partition count breaks the guarantee for existing conversations.** It is set to 12
up front for that reason. Changing it safely needs a drain-and-migrate, which is not implemented.

**Redis is a hard dependency for delivery, though not for durability.** No fallback path, on
purpose — a same-node shortcut would reintroduce the two-path problem in §4.2.

**Consumer failure detection is tuned to 10 s, not zero.** Between a node dying and the group
noticing, its partitions are stranded: those conversations accept sends but nothing is written or
delivered until the rebalance completes. Lowering it further trades against evicting healthy
consumers during a GC pause.

**A partition stalls rather than dropping a record it cannot write.** Spring Kafka's default error
handler retries ten times and then skips the record — silent loss under database pressure. The
writer retries indefinitely instead, so a persistent failure pauses the conversations on that
partition. That is the right trade for this claim, but one bad dependency can stop one twelfth of
conversations rather than degrading all of them evenly.

**Backpressure terminates rather than degrades.** A client 1 MB behind has its socket closed.
Correct for chat — reconnect and re-sync is cheap — but a very slow network can produce a reconnect
loop, and there is no server-side backoff discouraging it.

**The unread counter drifts by design.** Marking a conversation read zeroes the counter even when
the cursor moved to a point in the middle, so messages after that point stop being counted. The
nightly reconciliation job is what puts it back.

**Presence is per user, not per device**, and a user whose last node dies stays "online" for up to
the remaining TTL.

**Matching ranking is BM25 over tag terms, not a tuned relevance model.** It does not weight rare
interests above common ones, so matching on "music" counts the same as matching on "volunteering".

**A blocked user is excluded from matching but not ejected from an existing conversation.**

**Reports are recorded, not acted on.** No moderation queue, nothing reads the table. Honest for a
project running with test users — and exactly the work that would have to exist *before* opening
anonymous image-sharing to real strangers. That is a separate undertaking, not a feature toggle.

**nginx does not re-resolve its upstreams.** Open-source nginx resolves upstream hostnames once at
startup, so recreating the replicas leaves it dialling stale container IPs until restarted.
Resolving per request would mean giving up the `least_conn` upstream block.

**Presigned read URLs are not revocable.** Valid for five minutes regardless of what happens
meanwhile; leaving a conversation or being blocked does not invalidate one already issued.

**Sign-out deletes the device token rather than revoking the JWT**, which stays valid for up to 24 h.
Revocation would need a denylist and a lookup on every request.

**Authentication everywhere, but no transport encryption.** Postgres (SCRAM), Redis
(`requirepass`), Redpanda (SASL/SCRAM-SHA-256), Elasticsearch (native realm), MinIO and Grafana
all require credentials. None of it is over TLS — inside a Docker network that is a reasonable
trade, across a real one it is not, and a deployment would use SASL_SSL and HTTPS with the same
credentials. Credentials also live in a `.env` file, which is a local-development convenience,
never a production secret store.

---

## 8. Running it

Infrastructure is shared with every other app on the box and lives in
[`platform`](https://github.com/shipyardworks/platform); metrics live in
[`observability`](https://github.com/shipyardworks/observability). This repo
contains the application, the harness and the client — nothing stateful.

> **This deliberately gives up R7.** Earlier versions shipped a self-contained `compose.yaml` so
> a reviewer could clone this repo alone and run everything with one command. That was traded
> away when the box stopped hosting only this app. It was a real cost, taken knowingly.

### Start the platform, once

```bash
cd platform
cp .env.example .env          # fill it in
./bootstrap.sh                # creates the syamdev-edge and syamdev-data networks

docker compose --env-file .env -f data/compose.yaml      up -d   # postgres, minio, redis-shush
docker compose --env-file .env -f streaming/compose.yaml up -d   # redpanda
docker compose --env-file .env -f search/compose.yaml    up -d   # elasticsearch
docker compose --env-file .env -f edge/compose.yaml      up -d   # nginx
```

### Start Shush

```bash
cp .env.example .env          # the ten values marked `# shared` must match the platform's
docker compose --env-file .env -f compose.platform.yaml up -d --build
```

Then **http://localhost:8081/**. Click *Start chatting*, and open a **private window or a second
browser** for the other person — two tabs of one browser share `localStorage`, so they are the
same account and matching correctly refuses to pair someone with themselves.

nginx resolves upstream hostnames once at startup, so after rebuilding the replicas:
`docker compose --env-file .env -f edge/compose.yaml restart nginx`.

### Tests

```bash
cd api && ./mvnw clean verify      # 173 tests, real infrastructure, nothing needs to be running
cd web && npm test                 # the browser journey, against a stack that IS running
```

The Java suite runs against real Postgres, Redis, Redpanda, Elasticsearch and MinIO, started and
thrown away by Testcontainers. It needs nothing up.

The browser journey moved to Playwright in `web/` when the frontend became its own container.
That is a real trade: `./mvnw verify` used to drive the client end to end because the client was
a single HTML file the API served itself, and it no longer can. `npm test` covers the same
journey — matching, both directions, images that actually load, requests visible to the
recipient, unread counts, ticks — but only against a stack that is already up.

**Stop the platform stacks first on a small machine.** The suite starts six containers of its
own, one of which is Chrome, and needs roughly 3 GB. With the platform's twelve already running
there is not enough left, and the failure is an opaque `ExceptionInInitializerError` from a
container that could not start rather than anything resembling out-of-memory.

### The harness

```bash
cd bench && ./mvnw clean package && cd ..

java -jar bench/target/shush-bench.jar --mode=ordering --via=nginx \
     --conversations=50 --messages=200 --assert-multinode

java -jar bench/target/shush-bench.jar --mode=chaos --via=nginx \
     --kill-node=api-2 --at-second=15 --conversations=50 --messages=500
```

Both exit 0 only if every invariant held. Needs `SHUSH_DEV_ENDPOINTS=true` in `.env` so the
harness can open conversations without going through matching; it is off by default. Chaos mode
leaves the replica dead — bring it back with `docker compose --env-file .env -f
compose.platform.yaml up -d`.

### Metrics

```bash
cd observability && docker compose --env-file .env -f compose.yaml up -d
```

Grafana on :3001, Prometheus on :9090. Targets are discovered from Docker labels, so that repo
knows nothing about this one.

---

## Documentation

| File | What it settles |
| ---- | --------------- |
| `docs/aim.md` | Why the project exists; locked technical decisions with rationale |
| `docs/pre-plan.md` | Every product behaviour, in plain English |
| `docs/plan.md` | Data model, mechanisms, phases, exit criteria |
| `docs/deploy.md` | Hosting, cost, benchmark procedure, nginx changes |
| `docs/implementation.md` | **What was actually built**, and every divergence from the plan |
| `bench/results/` | Raw harness output, hardware, and how to reproduce it |

### The frontend

`web/` is a Next.js app in its own container. nginx serves it at `/` and proxies `/api` and
`/ws` to the API replicas, so the browser only ever sees one origin and nothing in the normal
path is cross-origin at all.

The landing page is a server component — real HTML before any JavaScript runs. Everything past
it is a live websocket and a session token held in this browser, which is client-side by
nature; rendering it on a server would be pretending.

Running the frontend on its own, against the same API:

```bash
cd web && npm install && npm run dev        # http://localhost:3000
```

That port *is* a different origin, which is what `cors_origins` is for — the two `localhost:3000`
rows are already there. Adding another frontend is one row:

```sql
INSERT INTO cors_origins (origin, note) VALUES ('https://example.com', 'why');
```

No redeploy: the set is re-read every 15 seconds. An empty table permits no cross-origin browser
call at all, which is the right default given the app and API share an origin in the deployed
stack.

---

## Open Choices

Decisions taken by the implementer because the specification did not cover them. Each is the
smallest reasonable choice, not a considered preference.

**Leaving is final, and the server says so.** Once either person leaves, the conversation is
closed: sends are refused with `conversation_ended`, the composer goes away, and asking to keep
them is the one thing still on offer. Both screens render from one `left` frame the server
sends to both sides — a client that prints "you left" on its own say-so is claiming something
the server may not have done, which is exactly how one side sat in a dead conversation typing
into it while the other had already gone.

**Changing your name is gone.** It was one click from a fresh identity for anyone who had just
been unpleasant under the old one, which is the wrong thing to make easy on a service built on
anonymity. A name is given once, at the door.

**Interests of your own are shared, not local — this reverses an earlier choice.** They used to
live only in `localStorage`, on the reasoning that the matcher needs a shared vocabulary and a
tag only one person has cannot pair anyone by construction. That reasoning was sound and the
conclusion was wrong: the fix for a private tag not being shared is to share it, not to keep it
private. A typed tag is now a real row in `interests`, deduped by a slugified key so "Xabc",
"xabc" and "  xabc  " all resolve to the same one — which is what lets two strangers who each
typed it be told "you both like xabc" and actually mean it. `id` moved from a hand-seeded
`smallint` to an identity column for this; nothing else about the matching pipeline changed,
because a tag someone typed an hour ago and one seeded on day one are the same kind of row.

**History of everything, strangers included.** `pre-plan.md` says a stranger conversation
nobody asked to keep does not survive its ending, and the retention job deleted it an hour
later. The owner asked for a history list covering every conversation, so the purge now only
reaps conversations with no messages in them — a matched pair who never spoke. The cost that
rule was protecting is image storage, and that is unchanged: media still expires on its own
schedule. Removing a friend is the same shape — they leave the friends list and stay in the
chat list, because ending a friendship is not the same as never having spoken.

**Deleting a message means two things.** Deleting your own removes the words for both people
and leaves a marker; the row and its `seq` survive, because `seq` is dense by design and a gap
reads as a lost message to the ordering harness. Deleting somebody else's hides it from you
alone and tells nobody — a separate table, because "they deleted it" and "I hid it" are
different claims and collapsing them would make them indistinguishable.

**Reactions are an allowlist of eight.** One per person per message, replaced rather than
accumulated. The emoji is stored as text and rendered by every client, so accepting arbitrary
strings would make a reaction a way to put anything into someone else's message list.

**Reactions and deletions do not go through Redpanda.** The log is the write-ahead log for
*messages*, which need an order, a sequence number and exactly one writer. A reaction has no
position in the conversation and a deletion edits a row that already has one. They are ordinary
writes; the fanout still goes through Redis, so the single delivery path is untouched.

**Removing a friend.** `pre-plan.md` says how you keep somebody and never how you stop. Left
alone that is a dead end rather than an omission: matching skips anyone you are already friends
with, so once two accounts had kept each other neither could ever be matched again — correct
behaviour, with no way out of it. `DELETE /api/friends/{userId}` removes the friendship and
nothing else; the conversation stays, because it still happened, and the retention job already
owns deciding when a kept conversation stops being worth keeping. It lives behind the profile
dialog rather than on the friends list, where it would be one stray click from permanent.

**Changing your name.** Shuffling used to sit on the screen you pass through before every
match, which made a new identity a single click away from anyone who had just been unpleasant
under the old one — and `pre-plan.md` step 9 says a returning visitor gets the flow *minus the
name step* anyway. It moved into the profile dialog. Nothing rate-limits it beyond the existing
throttle, so this narrows the invitation rather than closing it.

**Read state.** One tick means the broker accepted it, two mean it is written and sequenced,
two in colour mean the other person's read cursor has passed it. That is the WhatsApp
vocabulary mapped onto acks and cursors the server already had, rather than new state. A client
only acknowledges a read while the conversation is actually on screen — acknowledging from a
hidden view would both lie to the sender and zero your own unread count.

**Infrastructure and running it**

- **Postgres publishes on host port `55432`, not `5432`.** The development machine runs a native
  Postgres bound to `0.0.0.0:5432`, which prevents Docker binding loopback `5432` at all. The
  container-side port is unchanged and `POSTGRES_PORT` overrides it.
- **Infrastructure moved out of this repo entirely**, to `platform` and
  `observability`, once the box stopped hosting only this app. That gives up R7 knowingly:
  see §8.
- **Topic, consumer group and search index are configurable** and tenant-prefixed on the
  platform, because a shared broker and cluster only grant a tenant its own prefix. Defaults keep
  the standalone names.
- **nginx listens on 8081**, so the replica stack and a host-run `spring-boot:run` can be up
  together.
- **Replica containers have an explicit 1 GB memory limit and the JVM takes 60% of it.**
  `MaxRAMPercentage` is a share of the *container's* limit — with none set that is the whole host,
  so three replicas each sized themselves for the entire machine, the box went into swap, and the
  broker began stalling its reactor for hundreds of milliseconds. The symptom looked exactly like
  message loss.
- **Listener concurrency is 4 per replica** (12 partitions ÷ 3), not the single-node default of 12.
  Otherwise the group has 36 members for 12 partitions and every rebalance shuffles all 36.
- **Elasticsearch and MinIO are in the `search`/`media` profiles, not `core`**, so a correctness run
  does not pay for them.

**Protocol and API**

- **`/api/health` is liveness; `/api/health/ready` is readiness.** A single endpoint delegating to
  the full Actuator aggregate timed out under load and declared a healthy node dead. Liveness now
  does no I/O; readiness checks Postgres and Redis but deliberately not Kafka or Elasticsearch — a
  broker or search blip must not take every replica out of rotation.
- **The server sends a `hello` frame on connect** carrying `nodeId`. Diagnostic only, but without it
  neither an operator nor the harness could tell a multi-node run from a single-node one.
- **`GET /api/media/**` returns a 302 to a presigned URL** and authorises on conversation membership
  rather than on possession of the key.
- **`PUT /api/interests/mine` records a selection.** `pre-plan.md` settles the behaviour but names
  no endpoint.
- **Conversations were created by a flag-guarded dev endpoint** before matching existed; it remains,
  off by default, because the harness needs it.

**Data model**

- **`friend_requests.status` gained a `declined` value** (`V5`). `plan.md` §2.2 allowed only
  `pending`/`accepted`/`expired`, which conflates "nobody replied" with "someone said no", and the
  purge rule needs to tell them apart.
- **A declined request means the conversation is not kept** and goes back on the purge clock.
- **The descending index on `(conversation_id, seq)` is not created.** A btree scans backwards as
  cheaply as forwards, so it would duplicate the unique constraint's index at the cost of a second
  write per message.
- **Name collisions past five random attempts fall back to `Adjective Noun N`.**

**Client**

- **`web/index.html` is copied into the jar at build time** and served by the API, so there is one
  source of truth and the image is self-contained. The Docker build context is the repository root.
- **The client generates `clientMsgId` with a `crypto.getRandomValues` fallback.**
  `crypto.randomUUID` exists only in a secure context, so on any plain-HTTP deployment that is not
  localhost it is undefined and every send throws.

**Testing**

- **Selenium in a container, not Playwright**, so the browser journey runs inside `./mvnw verify`
  with no Node toolchain to install.
- **TTLs are shortened in tests** (presence, typing, shuffle) so expiry is something a test observes
  rather than assumes. The behaviour under test is that these keys expire on their own, not the
  exact duration.
