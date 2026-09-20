# Shush — aim, decisions, and the product

Why this exists, what is locked, and every behaviour a user can observe.
Read [`README.md`](README.md) first for the map; [`implementation.md`](implementation.md) is
what was actually built.

> This file absorbed `pre-plan.md`. Its sections live under [§Product](#product) with their
> original numbers, so a comment citing `pre-plan.md §3` means **Product §3** here.

---

## 1. Aim

**The sole aim of Shush is to be a resume and interview artifact.** Monetisation, user growth
and public launch are out of scope — not deferred, out.

The domain is deliberately unoriginal. The interviewer already knows what a message is, so
100% of their attention goes to the architecture instead of to the product. Corollaries, not
to be re-litigated: no competition to worry about, no cold-start problem, originality scored
at zero.

### 1.1 The success criterion

One resume bullet that survives a 30-minute interrogation, plus a README that makes a hiring
manager want to have it. Write the code backwards from this:

> Built a horizontally-scaled real-time messaging service in Java 21 / Spring Boot guaranteeing
> strict per-conversation message ordering and exactly-once delivery semantics across N
> stateless nodes; sustained 10k concurrent WebSocket connections and 5k msg/s at p99 < 80ms
> end-to-end, verified by a load harness that asserts zero reordering and zero duplicates under
> induced node failure.

Note its shape: **a guarantee**, **a number**, **a proof**. Judge every scoping decision
against whether it strengthens one of the three. If it strengthens none, cut it.

### 1.2 Why this project

The strongest line on the existing resume is *"eliminated message interleaving in the
production WhatsApp chatbot using an XState.js state machine and key-partitioned Redpanda
topics, pinning each conversation to a single consumer for strict in-order processing."*
Shush is the proof artifact for exactly that claim, at larger scale with the reasoning made
explicit. It secondarily backs the Elasticsearch bullet. That alignment is the reason to build
chat rather than anything else.

### 1.3 Non-goals

| Not doing | Why |
| --- | --- |
| Public launch to real strangers | Anonymous stranger-chat with open media upload creates IT Rules 2021 intermediary obligations and a CSAM liability surface. Non-negotiable: seeded test users only |
| "Mental health app" positioning | Buys nothing on a resume, adds duty-of-care exposure |
| Group chats | Fanout complexity without new *kinds* of problem |
| Video / voice | Different domain entirely (WebRTC, TURN); zero overlap with the bullet |
| Push notifications | Vendor integration work, not distributed-systems work |
| Payments, mobile apps, bots | Product features |

---

## 2. Requirements

These follow from "the aim is a resume artifact" and outrank any feature list.

- **R1 — State a falsifiable guarantee.** "A chat app" is not a claim. Written down formally in
  the README, with the exact conditions under which it holds.
- **R2 — Measured, not asserted.** Every number comes from a benchmark a reviewer can re-run
  with one command.
- **R3 — Invariants tested adversarially.** The harness asserts correctness under stress — zero
  reordering, zero duplicates, zero loss — including while a node is killed. Highest-signal
  component in the project.
- **R4 — Actually runs horizontally scaled.** Three replicas behind a load balancer, by default.
  The cross-node case is the point.
- **R5 — Decisions documented with rejected alternatives.** §4 here is the source; the README
  gets the interview form.
- **R6 — Known limitations documented.** Where it breaks, at what scale, what would fix it.
- **R7 — Trivially runnable.** `git clone && docker compose up` brings up everything.
  **Knowingly given up** when infrastructure moved to `platform` — see
  [`implementation.md`](implementation.md).
- **R8 — Finished.** A 60%-complete project is worth zero. Scope is the servant of completion;
  never cut R1, R2, R3 or R8.

### 2.1 The deliverable is the README

The code is necessary but is not read first. The root README must contain: the guarantee, an
architecture diagram, the hard problems and how each was solved, design decisions with
rejected alternatives (*the section that hires you*), benchmarks with methodology, the
correctness harness, known limitations, and one command to run it.

---

## 3. The hard problems

The technical core, and the reason chat was chosen. Each must be defensible in an interview.

1. **Per-conversation ordering under concurrent producers.** Both participants send
   simultaneously from different nodes; every observer must see one total order. Partition key
   from the conversation id, plus a monotonic per-conversation sequence.
2. **At-least-once delivery, exactly-once effect.** Client-supplied idempotency keys, a unique
   constraint, and dedup on the receive path so a reconnect never surfaces a duplicate.
3. **WebSocket fanout across replicas.** A holds a socket on node 1, B on node 3; node 1 has no
   route to B. Needs a backplane and a connection registry. The first thing a good interviewer
   probes.
4. **Presence and typing at keystroke rates.** High-write, low-value, must expire without
   cleanup — a crashed node must not leave users online forever. TTL keys, heartbeat refresh,
   and an explicit answer on write amplification.
5. **Media without bytes through the API.** Presigned PUT, size and MIME allowlist, key
   namespacing, and a reconciliation path for uploads never confirmed.
6. **Unread counts without hammering the database.** A `COUNT(*)` per conversation per page
   load collapses immediately. Maintained counters, a read cursor, and a documented
   reconciliation strategy for drift.
7. **Interest matching.** Overlapping tags with a defensible scoring function — the ranking
   logic stated, not "it returns some users".

---

## 4. Locked decisions

**Do not reopen these.** If one proves actively wrong, stop and say so with evidence — never
substitute silently.

| Area | Decision |
| --- | --- |
| Project aim | Resume/interview artifact. Not a product |
| Language & framework | Java 21 LTS + Spring Boot 3, **Spring MVC on virtual threads**, not WebFlux |
| Event log | Redpanda (Kafka protocol), self-hosted |
| Search | Elasticsearch 8, single node |
| Build tool | Maven (`./mvnw`) |
| Data access | Spring Data JPA + Hibernate, `ddl-auto: validate` |
| Migrations | Flyway, raw SQL, **forward-only** |
| Testing | JUnit 5 + Testcontainers. Real infrastructure, never a mocked broker |
| Object storage | S3 API — MinIO self-hosted, real S3 if ever deployed |
| Product behaviour | [§Product](#product) below, settled |

Each decision below has **the actual reason** (honest, includes career strategy — for you) and
**the interview answer** (the same reasoning, narrowed to this system's requirements — what you
say out loud). Not two sets of facts: every technical claim in the interview answer is one you
acted on and can defend under follow-up.

### 4.1 Java 21 + Spring Boot 3 — over Node/NestJS and over Go

**The actual reason.** Target-company hiring reality dominates: Amazon, Oracle, Flipkart and
Google are Java-first, and the Java+Spring pool in India is several times the Go pool. The
NestJS background makes Spring cheap — Nest is modelled on it, so `@Injectable` → `@Service`
transfers almost 1:1, which protects R8. Virtual threads close most of the gap to Go; what
remains is memory per connection, not programming model. Java 21 + Loom also differentiates
against the median 1-YOE candidate who knows Java 8. **Named cost:** Go is arguably the better
pure technical fit — cheaper goroutines, lower memory per connection, faster startup, single
binary, no GC tuning. Some elegance is traded for market reach.

**The interview answer.** *Why not Node, given that is your production stack?*

1. **Concurrency model.** ~10k mostly-idle connections each holding state. Any CPU-bound work
   on the message path blocks Node's single loop and stalls every connection on that process;
   scaling past one core means `cluster` — N processes, N heaps, no shared memory. Virtual
   threads give per-connection blocking-style code *with* true multi-core parallelism in one
   process.
2. **Shared in-process state.** The connection registry and presence cache are hot and
   node-local. Under cluster mode each worker has an isolated heap, so all of it must be
   externalised to Redis — a network hop for state that is inherently local. One JVM holds every
   connection on that node in one `ConcurrentHashMap` across all cores, leaving Redis for
   genuinely cross-node state. That is the correct boundary.
3. **Real concurrency primitives.** Dedup windows and ordering need `ConcurrentHashMap`,
   `StampedLock`, `LongAdder` and a specified memory model to reason about visibility.
4. **Ecosystem depth.** Kafka's reference client *is* the Java client. For a system whose
   central claim is about Kafka partitioning semantics, running on the reference implementation
   is defensible on its own.
5. **Backpressure.** Netty exposes write-buffer watermarks and `isWritable()`; a client that
   cannot drain must not be buffered unboundedly. Node's `ws` offers very little here.
6. **Observability.** JFR, async-profiler, heap dumps, JMH. R2 demands defensible numbers.

*Why not Go?* Virtual threads gave Loom-style ergonomics while the JVM gave a more mature
Kafka/Elasticsearch/observability ecosystem. Then **name Go's real advantages out loud** —
cheaper goroutines, lower memory, faster startup, single-binary deploys, no GC pauses. Knowing
the downsides of your own choice is the seniority signal.

*Why MVC on virtual threads rather than WebFlux?* Reactive costs a great deal in
debuggability — stack traces stop meaning anything, and every library in the chain must be
non-blocking or the benefit evaporates. Loom gets the same scalability with ordinary blocking
code. Be ready to say when WebFlux still wins: true streaming backpressure end to end.

### 4.2 Redpanda — over Apache Kafka

**The actual reason.** No free managed Kafka exists any more, and self-hosting is required by
R7 regardless. Redpanda runs in ~1 GB where Kafka wants ~1.5 GB of heap; no ZooKeeper, no KRaft
quorum, a single binary that starts in seconds — every hour not spent on broker configuration
is an hour spent on §3. The resume already says "Kafka/Redpanda" and the production ordering
work was done on Redpanda, so the project and the work history tell one story. (The original
deployment target was ARM64 Graviton, where Confluent's images are patchy; that box is gone,
but nothing about the decision depended on it.)

**The interview answer.** Start by removing the false premise: **this is not a choice about
Kafka semantics.** Redpanda implements the Kafka wire protocol, and the project uses the actual
Apache Kafka Java client through Spring Kafka, unchanged. Partition assignment, key-based
partitioning, consumer groups, offsets, rebalancing and delivery semantics are identical
because they are defined by the protocol. The central claim lives at the protocol level.

Then the operational reason: equivalent semantics at a lower footprint — one C++ binary,
thread-per-core (Seastar), no JVM and so no GC tuning, Raft replication built in rather than
layered on ISR.

Be ready for *"would you run it in production?"* — it depends on what surrounds it. Kafka has a
far larger ecosystem (Connect, Streams, mature tiered storage) and vastly more engineers who
can operate it, which is often decisive on a real team. Redpanda wins on operational simplicity
and tail latency. Self-contained service with no connector requirement: Redpanda. Company-wide
event backbone with heavy Connect usage: Kafka.

### 4.3 Elasticsearch — over pgvector

**The actual reason.** Reinforces the existing "Elasticsearch-backed RAG retrieval" bullet, and
as a distinct distributed system it opens real interview surface — shard strategy, the
refresh-interval-versus-freshness trade, mappings and analyzers — where pgvector is a Postgres
extension with a thinner discussion. pgvector would also need an embedding model in the request
path, to serve the *least* important requirement in §3. **Named risk:** it is the heaviest
component in the stack serving the weakest requirement. If memory gets tight this is the first
thing to cut — a Postgres GIN index on a tags array handles overlap well, and documenting that
trade recovers most of the value.

**The interview answer.** It is a data-shape argument. Matching is term overlap over a
controlled tag vocabulary — a lexical retrieval problem, and an inverted index with BM25 is the
natural structure for term overlap with ranking. ANN search over embeddings solves a *different*
problem: similarity between things that share no terms. That problem does not exist when both
sides draw from the same tag set. Vector search would add an embedding model to the request
path — latency, an external dependency, re-embedding and model drift — to approximate a set
overlap that can be computed exactly. Matching also needs filtering and aggregation (exclude
blocked users and existing friends, boost recent activity), which ES gives in one query.

Then name the boundary unprompted: **pgvector becomes the right answer the moment the input
stops being a controlled vocabulary** — free-text bios, cross-language matching, "users like
this user" derived from behaviour. Knowing where your own choice stops being correct is the
strongest form of this answer.

### 4.4 Maven — over Gradle

**The actual reason.** Matches the target companies (Gradle's dominance is Android, not the
target), and protects R8: Spring is being learned at the same time, and a build tool that does
one predictable thing removes a whole category of distraction. Gradle build files are programs.

**The interview answer.** Scope-appropriate tooling. One module, a fixed dependency set; the
build is not a problem that needs solving. Maven's rigidity is the feature — a declarative POM
means no build logic to maintain or hand to a reviewer, and reproducibility by construction.
Versions pinned exactly, no ranges: basic supply-chain hygiene. Gradle earns its complexity on
large multi-module builds and on Android; neither condition holds here.

### 4.5 The stack

| Layer | Choice |
| --- | --- |
| Language / framework | Java 21 LTS (Temurin) · Spring Boot 3, MVC on virtual threads |
| Build | Maven |
| Database | PostgreSQL 16 |
| Cache, presence, backplane | Redis 7 |
| Event log | Redpanda (Kafka protocol) |
| Search / matching | Elasticsearch 8, single node |
| Object storage | MinIO (S3 API) |
| Metrics | Prometheus + Grafana via Actuator/Micrometer |
| Ingress | nginx, `least_conn`, no stickiness |
| Testing | JUnit 5 + Testcontainers · Playwright for the browser journey |
| Harness | Standalone Java, sharing no code with `api/` |

Two notes that are themselves design decisions. **The storage layer is S3-API-abstracted** —
MinIO locally, real S3 by changing an endpoint. **Testcontainers is close to mandatory for
R3**: asserting ordering against a mocked broker proves nothing, because partitioning is
precisely what the mock removes.

---

## Product

Everything a user can observe, settled. **Do not ask the owner product questions.** If
something genuinely is not covered here, make the smallest reasonable choice, implement it, and
list it under `## Open Choices` in the root README.

Section numbers are those of the former `pre-plan.md`. Where the built product deliberately
departs, [`implementation.md`](implementation.md) says so and is the current truth.

### Product §1 — What Shush is

A website where you can be talking to a stranger who shares your interests within seconds of
arriving — no sign-up, no form, no email. Pick a couple of interests, get given a name, get
matched. If it goes well you can ask to keep them; if they agree they are in your friends list.
Save the account with an email whenever you like, and everything comes with you.

### Product §2 — The principles

1. **Talking comes first.** A new visitor is in a conversation within about three clicks.
2. **Nothing is asked twice.** No confirmation, no profile setup. If we can decide it for you, we do.
3. **Anonymous is a real choice, not a trial.** The anonymous experience is complete; signing up
   protects what you have, it does not unlock basics.
4. **You meet people by being matched, never by browsing.** No directory, no search.
5. **One conversation at a time.** Like a real conversation.
6. **You always know where you stand.** If the account only exists in this browser, we say so.

### Product §3 — The journey

**Landing.** A short line explaining what this is, and one button: *Start chatting*.

**Interests.** Five tiles. A first-time visitor sees the five most popular; a returning visitor
sees their own. A *show others* link opens the full list. Tap one or two and *Continue* lights up.

**Your name.** Assigned automatically — *Quiet Otter*, *Amber Fern* — with unlimited shuffling;
you always get a name nobody else is using. You never type a username or pick a password.

**Patience.** Three options above *Find someone*:

| Option | Meaning |
| --- | --- |
| **5 seconds** *(default)* | Try for a shared interest; after 5s, anyone |
| **10 seconds** | Same, try a bit harder first |
| **Wait as long as it takes** | Only ever match on a real shared interest |

An honest speed-versus-quality dial. When Shush is quiet, the 5-second option usually hands you
a random person — which is the point of it.

**The conversation** opens with the shared interests shown at the top, or a note that this was a
random match. Text and photos. Typing indicators and read receipts.

- **If they lose connection, you are told** — a quiet line saying they are offline. The
  conversation stays open, and anything you send reaches them when they return, in order.
- **If they deliberately leave, you are told that too**, and the conversation is over.

**Keeping someone.** An *Add friend* button in every conversation. It works during the
conversation *and after it has ended* — it appears as the last item in the thread, so a good
chat is not lost because someone closed their laptop first.

- **They accept** → friends, conversation kept with full history, either can reopen it.
- **They decline** → nothing is announced. You simply never hear back.
- **Nobody asks** → the conversation is deleted. **Conversations survive only if at least one
  person wanted them to.**

**Saving the account.** Asked exactly once, right after your first friend request is accepted —
the first moment you have something you would be sad to lose. Honest wording: *"Right now the
only thing connecting you to Quiet Otter is this browser."* Email and password attach to the
row you already have; name, friends, conversations and history are untouched because nothing
is migrated. Decline and a small non-blocking reminder stays in the corner.

**Coming back.** Signed up: sign in from any device. Not signed up, same browser: everything is
still there. You see your friends, who is online, and unread counts. Opening a friend closes
whatever was open — and if that was a stranger, that conversation ends. Strangers do not wait
around; friends do.

### Product §4 — The feature list

*Getting started* — no-sign-up start · five interest tiles (popular, or your own) · full list
behind *show others* · assigned name with unlimited shuffle · patience selector · identity
persists in this browser.

*Chatting* — 1:1, one at a time · text · photos, strangers included · shared interests in the
header · typing indicator · read receipts · told when they go offline · told when they leave ·
offline messages delivered on return, in order · no duplicates on a flaky connection · full
scrollback.

*People* — friend request during or after a conversation · accept or silently decline · friends
list · online status · per-friend unread counts · invite link · block · report.

*Account* — attach an email whenever you like · everything transfers · choose your own name once
signed up · sign in anywhere · sign out.

*Look* — dark and light, **dark by default**, choice remembered.

### Product §5 — Why anyone would sign up

The anonymous experience is complete, so signing up has to protect something real, in order of
how much it matters:

1. **Your friends disappear with your browser.** Clear history, private window, new laptop — on
   that day you lose every person you connected with, permanently, and they cannot reach you
   either. This is the real one.
2. **You are stuck on one device.**
3. **You can pick your own name.** Assigned names are only ever assigned.
4. **Photos expire sooner in anonymous conversations.** A genuine cost difference, not an
   invented restriction — storing images costs money.

**The timing matters more than the wording.** Not on arrival; the moment a friend request is
accepted. **No artificial limits** — no "3 friends without an account", no locked features.
Invented gates would make the product feel manipulative.

### Product §6 — Why there is no searching for people

1. **The names are random**, so searching them is meaningless.
2. **It is the main tool for harassment.** If someone leaves because they are uncomfortable,
   name search lets the other person find them again. Without it, leaving actually works.
3. **It fights the premise.** You meet people by being matched.

The genuine need underneath — *"come talk to me on Shush"* — is the **invite link**: opt-in on
both sides, useless for trawling.

### Product §7 — How names are made, and why not with AI

Two curated lists, ~200 adjectives and ~200 nouns → 40,000 combinations, plus a number when one
is taken. How Docker names containers.

Cost was never the objection (~₹220 per 10,000 names). The objections: **it is slow** (half a
second inside a three-click flow), **it can fail** (a spinner on a first visit), and **it can
produce something offensive** — two curated lists physically cannot.

### Product §8 — Two questions that were asked

**8.1 "Why store anything? Can't it all live in the browser until signup?"** Most of it cannot,
because a conversation has two people in it. The browser holds a token and a theme — a key, not
a filing cabinet. The rest must be server-side: **a message sent while you are offline has to
wait somewhere**, and it cannot wait in a browser that is not running (this settles it alone);
a friendship is two-sided; online status only works if we know; names must be unique across
browsers; matching needs both sides at once.

So **anonymous means we do not know who you are, not that we store nothing.** Signing up does
not create an account — it attaches an email to the one you already had, which is why nothing
resets. The browser holds the only key; adding an email is adding a second key.

**8.2 "What's wrong with unlimited shuffling?"** Nothing. Unlimited shuffles, always a free
name, custom names reserved for signed-up accounts. Two non-serious notes: some people will
shuffle for a while, which is their time; and a script could churn the pool, so shuffling is
capped at roughly one per second.

### Product §9 — Deliberately not built

Browsing or searching for people · group chats · multiple simultaneous conversations · voice or
video · phone notifications · profile pictures, bios, or profiles at all (your interests are
your profile) · a public launch to real strangers.

### Product §10 — One thing to be aware of

This runs with test users, which is what makes anonymous-plus-photos safe to build. Opened to
the real public, anonymous strangers sending each other images would need proper moderation and
reporting infrastructure from day one — a serious, separate piece of work, not a feature toggle.
Worth knowing now so the decision is never made casually later.
