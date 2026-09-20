# Shush — start here

Real-time 1:1 chat. Strangers are matched on shared interests, talk, and can keep each other
as friends. Live at [shushchat.syamdev.site](https://shushchat.syamdev.site), test users only.

**This is a portfolio and interview artifact, not a product.** It exists to make one claim and
prove it. When a decision trades product value for demonstrable engineering depth, take the
depth.

> Strict per-conversation total ordering with effectively-exactly-once delivery, across N
> stateless nodes, verified by an automated harness that asserts zero reordering, zero
> duplicates and zero loss — including while a node is killed mid-run.

---

## The documents

| File | What it settles | Read it when |
| ---- | --------------- | ------------ |
| **this file** | The map: topology, invariants, working rules | First, always |
| [`aim.md`](aim.md) | Why the project exists · locked technical decisions and their rationale · **every product behaviour** | Before designing anything, or answering "why X and not Y" |
| [`implementation.md`](implementation.md) | **What actually exists**: architecture, mechanisms, data model, every divergence from the plan, every bug found | Before changing code |
| [`deploy.md`](deploy.md) | The live box and the commands that deploy to it | Before touching the server |
| [`SCHEMA.md`](SCHEMA.md) | The schema, **generated** by `SchemaDocIT` from a real Postgres on every `./mvnw verify` | Never edit it — it is asked, not maintained |

The root [`README.md`](../README.md) is the deliverable: the formal guarantee, design
decisions in interview form, benchmarks, known limitations, and Open Choices. It is written
for a reviewer; these are written for whoever is building.

---

## Three repositories, one box

Infrastructure left this repo when the box stopped hosting only this app.

```
platform/        everything stateful — postgres, minio, redis-shush, redpanda,
                 elasticsearch, nginx. One tenant prefix per app, isolation verified.
observability/   prometheus + grafana. Discovers targets from Docker labels.
shush-chat/      this repo — api (3 stateless replicas), web, bench, docs. Nothing stateful.
```

`github.com/shipyardworks/{platform,observability,shush-chat}`, all checked out at
`/root/` on the server. Each carries its own `.env`; ten values are shared between
`platform/.env` and `shush-chat/.env` and must match.

**This knowingly gives up `aim.md` R7** — a reviewer can no longer clone one repo and run one
command. Taken deliberately by the owner; the replacement is the ordered bring-up in
[`deploy.md`](deploy.md) §5.

```
                     ┌──────────────────────────────┐
 Browser ── WSS ─────►   nginx  (platform/edge)      │  least_conn, no stickiness
                     └──┬──────────┬──────────┬──────┘  / → web, /api /ws → api
                        │          │          │
                   ┌────▼───┐ ┌────▼───┐ ┌────▼───┐
                   │ api-1  │ │ api-2  │ │ api-3  │     Spring Boot, virtual threads
                   └─┬────┬─┘ └─┬────┬─┘ └─┬────┬─┘
          produce ───┘    └─sub─┤    └─sub─┤    └─ sub
                │               │          │
        ┌───────▼──────┐  ┌─────▼──────────▼─────┐
        │   Redpanda   │  │        Redis         │
        │ chat.messages│  │ pub/sub · presence   │
        │ key = convId │  │ typing  · matchpool  │
        └───────┬──────┘  └──────────────────────┘
                │ consume (group: chat-writer)
        ┌───────▼──────┐  ┌──────────────┐  ┌──────────────┐
        │  PostgreSQL  │  │Elasticsearch │  │ MinIO / S3   │
        │ system of    │  │  matching    │  │    media     │
        │  record      │  └──────────────┘  └──────────────┘
        └──────────────┘
```

**The central idea:** Redpanda is the write-ahead log. A message is produced first, keyed by
`conversationId`; one consumer group is the only writer to `messages`. One conversation → one
partition → one consumer → one order. That is where the guarantee comes from.

---

## Invariants — breaking one of these is a bug, not a trade

- **Redpanda is the write-ahead log.** The `chat-writer` consumer is the *only* writer to
  `messages`. Never insert a message from a controller — that is the dual write the design removes.
- **Ordering comes from the partition key.** Never key by anything but `conversationId`.
- **Fanout always goes through Redis**, even when both users are on the same node. One path, so
  same-node cannot silently work while cross-node is broken.
- **No sticky sessions, ever.** If something only works with `ip_hash`, the backplane is broken.
- **Never mock Kafka.** Partitioning is exactly what a mock removes. Testcontainers, real broker.
- **`clientMsgId` is the idempotency key**, enforced by a unique constraint. Dedup is a database
  guarantee, not application logic.
- **Media bytes never touch the API.** Presigned PUT direct to object storage, HEAD to confirm.
- **`seq` is dense.** Deleting a message clears its body, never the row — a gap reads as loss.
- **Consumers and schedulers never run on the API deployable** in a real deployment.
- **Scheduled jobs hold a Redis lock** and skip when held — never queue, never overlap.
- **Never log** message bodies, tokens, emails, or media keys.
- **Never weaken a test to make it pass.** If the harness fails, the system is wrong.

---

## Working rules

1. **Product behaviour is settled in [`aim.md`](aim.md) §Product. Do not ask the owner product
   questions.** If something genuinely is not covered, make the smallest reasonable choice,
   implement it, and add it to `## Open Choices` in the root README.
2. **The locked decisions in [`aim.md`](aim.md) §4 are locked.** If one proves actively
   wrong, stop and say so with evidence — never substitute silently.
3. **Record divergences.** Anything built differently from what these docs describe goes in
   [`implementation.md`](implementation.md) with the reason, when it is made.
4. **Human-only actions:** `git push` · merging to `master`/`develop` · force push or history
   rewrite · applying a migration anywhere but a local throwaway container · editing an applied
   migration (never — add the next file) · anything on the server · `sudo` · destroying local
   state (`docker compose down -v`, deleting `data/`) · rewriting `docs/`.
5. **Build with `./mvnw`**, the committed wrapper — never system `mvn`.

Conventions — branches (`<type>/p<phase>-<kebab-summary>`), Conventional Commits, naming across
Postgres/JSON/Java/Redis/Kafka — are in [`../CLAUDE.md`](../CLAUDE.md).

---

## Commands

```bash
cd api  && ./mvnw clean verify     # compile + ~200 tests on real infra via Testcontainers
cd api  && ./mvnw spring-boot:run  # app on the host, debugger attaches, :8080
cd web  && npm test                # Playwright, against a stack that is already up
cd bench && ./mvnw clean package   # the invariant harness

java -jar bench/target/shush-bench.jar --mode=ordering --via=nginx \
     --conversations=50 --messages=200 --assert-multinode
java -jar bench/target/shush-bench.jar --mode=chaos --via=nginx \
     --kill-node=api-2 --at-second=15 --conversations=50 --messages=500
```

Infrastructure for local work comes from the `platform` repo; this repo's
`compose.platform.yaml` brings up only the three replicas and the web container. Full
sequence in [`deploy.md`](deploy.md) §5.

---

## Older citations

`docs/` was five files and is now four plus the generated schema: `pre-plan.md` and `plan.md`
were folded into the files above. Code comments written earlier cite them by section, and the
section numbers were preserved, so every one of those citations still resolves:

| A comment saying | Means |
| ---------------- | ----- |
| `pre-plan.md §N` | [`aim.md`](aim.md) → **Product** §N — same numbering |
| `plan.md §2.2` (schema) | [`implementation.md`](implementation.md) → **Data model**, and [`SCHEMA.md`](SCHEMA.md) for the live truth |
| `plan.md §3.x` (mechanisms) | [`implementation.md`](implementation.md) → **Mechanisms** §3.x — same numbering |
| `plan.md §0.1` (locked decisions) | [`aim.md`](aim.md) → **Locked decisions** |
| `plan.md §5` (phases) | [`implementation.md`](implementation.md) → **Phase history** |
| `aim.md R1`–`R8` (requirements) | unchanged, still in [`aim.md`](aim.md) |
