# Shush

Real-time 1:1 chat. Strangers are matched on shared interests, talk, and can keep
each other as friends. **This is a portfolio/interview artifact, not a product** —
when a decision trades product value for demonstrable engineering depth, take the depth.

`api/` Java 21 + Spring Boot 3 (MVC on virtual threads) · `web/` Next.js frontend
· `bench/` load + invariant harness · Postgres · Redis · Redpanda · Elasticsearch · MinIO

Build: **Maven** (`./mvnw`, the committed wrapper — never system `mvn`).

## Read before working

**Start with `docs/README.md`** — the map: repo topology, architecture, invariants, and
which file settles what. It links the rest.

| File | What it settles |
| ---- | --------------- |
| `docs/README.md` | The map: three repos, architecture, invariants, working rules |
| `docs/aim.md` | Why the project exists; locked decisions + rationale; **every product behaviour** (§Product) |
| `docs/implementation.md` | **What was actually built**: mechanisms, data model, divergences, every bug found |
| `docs/deploy.md` | The live box (`ssh syam-hetzner`) and the commands that deploy to it |
| `docs/SCHEMA.md` | Generated from a real Postgres by `SchemaDocIT`. Never edit it |

Older code comments cite `pre-plan.md §N` and `plan.md §N` — both were folded into the files
above with their section numbers preserved. `docs/README.md` has the redirect table.

**Product behaviour is settled in `docs/aim.md` §Product. Do not ask the owner product
questions.** If something genuinely isn't covered, make the smallest reasonable choice,
implement it, and list it under `## Open Choices` in the README.

**The locked decisions in `docs/aim.md` §4 are locked.** If one proves actively wrong, stop
and say so with evidence — never substitute silently.

## Human-only actions

The agent may write the code and run it locally. These are executed by a person, always:

1. **`git push`** — any branch, any remote. The agent commits; the human pushes.
2. **Applying a migration to anything but a local throwaway container.** The agent may
   write new migration files. Applying them to a shared, remote, or persistent database
   is human-run.
3. **Editing a migration that has already been applied.** Never — add the next file.
4. **Merging into `master` or `develop`.**
5. **Force push or history rewrite.** `--force`, `rebase` on a pushed branch, `reset --hard`
   on shared history. If it's needed, the human does it with `--force-with-lease`.
6. **Anything on the server** (`ssh syam-hetzner`) or any action that spends money — resizing,
   volume growth, new cloud resources. The agent commits; a human deploys (`docs/deploy.md`).
7. **`sudo`** — installing packages, changing system config.
8. **Destroying local state** — `docker compose down -v`, `docker system prune`, deleting
   volumes or `data/`. These wipe the dev database.
9. **Changing a locked decision** in `docs/aim.md` §4, or rewriting anything in `docs/`.

Never, by anyone: commit a secret, weaken a test to make it pass, or disable a failing
invariant check. If the harness fails, the system is wrong.

## Branches

```
<type>/p<phase>-<kebab-summary>
```

`feat/p2-ordering-guarantee` · `fix/p3-backplane-reconnect` · `docs/p8-readme`

Cut from `develop`, merge back to `develop`. `master` is the stable default branch and
only ever receives merges from `develop`. One branch per phase.

## Commits

[Conventional Commits](https://www.conventionalcommits.org). All lowercase.

```
<type>(<scope>): <subject>
```

- **subject**: imperative mood, no trailing period, ≤72 chars — *"add dedup on client
  message id"*, not *"Added deduplication."*
- **scope**: the package or area touched. Omit only when genuinely global.
- Body (optional, after a blank line) explains *why*, never *what*.

| Type | Use for |
| ---- | ------- |
| `feat` | New capability |
| `fix` | Corrected behaviour |
| `docs` | Documentation only |
| `refactor` | Restructuring with no behaviour change |
| `test` | Adding or correcting tests |
| `perf` | Performance work with a measured result |
| `build` | Maven, Docker, compose, dependencies |
| `chore` | Everything else (gitignore, tooling, housekeeping) |

Scopes: `auth` `user` `conversation` `message` `realtime` `presence` `matching` `social`
`media` `scheduler` `bench` `web` `infra` `docs`

```
feat(message): assign monotonic seq in the writer consumer
fix(realtime): unsubscribe redis channel on socket close
test(matching): assert two matchers never claim the same user
```

## Naming

| Thing | Casing | Example |
| ----- | ------ | ------- |
| Postgres tables | `snake_case`, plural | `conversation_participants` |
| Postgres columns | `snake_case` | `client_msg_id`, `read_cursor_seq` |
| Indexes | `<table>_<cols>_idx` | `messages_conversation_seq_idx` |
| Unique constraints | `<table>_<cols>_key` | `messages_conversation_seq_key` |
| Flyway migrations | `V<n>__<snake_case>.sql` | `V3__add_friend_requests.sql` |
| **JSON / WebSocket fields** | `camelCase` | `conversationId`, `clientMsgId` |
| Java packages | lowercase, no underscores | `site.syamdev.shush.matching` |
| Java classes | `PascalCase` | `MessageWriterConsumer` |
| Java methods, fields, locals | `camelCase` | `assignSequence` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_MEDIA_BYTES` |
| Unit tests | `<Class>Test` | `NameAllocatorTest` |
| Integration tests | `<Class>IT` | `MessageOrderingIT` |
| Redis keys | `colon:delimited` | `presence:{userId}` |
| Kafka topics | `dot.delimited` | `chat.messages` |
| Env variables | `SCREAMING_SNAKE_CASE` | `SHUSH_JWT_SECRET` |

JSON is `camelCase` — Jackson's default and what `plan.md` §3 already specifies for the
WebSocket protocol. Postgres stays `snake_case`. Map at the edge; don't "fix" either side.

## Invariants

- **Redpanda is the write-ahead log.** A message is produced first, keyed by
  `conversationId`; the `chat-writer` consumer is the *only* writer to `messages`. Never
  insert a message from a controller — that reintroduces the dual write the design removes.
- **Ordering comes from the partition key.** One conversation → one partition → one
  consumer → one order. Never key by anything but `conversationId`.
- **Fanout always goes through Redis**, even when both users are on the same node. One
  path, so same-node can't silently work while cross-node is broken.
- **No sticky sessions, ever.** Any node serves any user. If something only works with
  `ip_hash`, the backplane is broken — fix that, not nginx.
- **Never mock Kafka.** Partitioning is exactly the behaviour a mock removes. Integration
  tests run against real infrastructure via Testcontainers.
- **`clientMsgId` is the idempotency key**, enforced by a unique constraint. Dedup is a
  database guarantee, not application logic.
- **Media bytes never touch the API.** Presigned PUT direct to object storage, then a HEAD
  to confirm before the message is accepted.
- **Consumers and schedulers never run on the API deployable** in a real deployment.
- **Scheduled jobs hold a Redis lock** and skip when held — never queue, never overlap.
- **Secrets only in `.env`** (gitignored). `.env.example` stays blank and committed.
- **Pin dependency versions exactly.** No ranges, no `LATEST`.
- **Never log** message bodies, tokens, emails, or media keys.

## Commands

```bash
cd api
./mvnw clean verify          # compile + all tests (Testcontainers pulls images first run)
./mvnw spring-boot:run       # app on the host, debugger attaches, :8080

# infrastructure runs in docker; the app under development does not
docker compose --profile core up -d              # postgres, redis, redpanda
docker compose --profile full up -d              # + elasticsearch, minio, prometheus, grafana
docker compose -f compose.yaml -f compose.replicas.yaml up -d --build   # 3 replicas + nginx

cd bench
./mvnw clean package
java -jar target/shush-bench.jar --mode=ordering --conversations=50 --messages=200
java -jar target/shush-bench.jar --mode=chaos --kill-node=api-2 --at-second=15
```

## Comments

Keep them rare. Comment only non-obvious *why* — a constraint someone could break by
accident. Do not restate what the code says.
