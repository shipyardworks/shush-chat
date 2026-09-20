# Deploying Shush

Runbook for the live box. Commands, in order, with the reason inline.
Architecture and rationale are in [`README.md`](README.md) and [`aim.md`](aim.md).

**Every command below runs on the server as `root` unless it says otherwise.**
The agent never runs them — it writes code and commits; a human deploys.

---

## 1. The box

| | |
| --- | --- |
| Host | `ssh syam-hetzner` — Hetzner, Ubuntu 24.04, **x86_64** |
| Size | 4 vCPU · 7.6 GB RAM · **no swap** · 75 GB disk |
| Live at | `https://shushchat.syamdev.site` (nginx :80/:443 published on `0.0.0.0`) |
| Repos | `/root/platform` · `/root/observability` · `/root/shush-chat` |
| Docker | 29.x, Compose v5 — `docker compose`, never `docker-compose` |

**x86_64 both ends.** Build on the box with a plain `--build`; no `buildx --platform`.
(The old EC2 Graviton box needed cross-builds. That box is gone. Ignore any `arm64`
instruction you find elsewhere.)

**Memory is the constraint, and there is no swap.** Steady state ≈ 4.2 GB of 7.6:

```
elasticsearch 1.1G │ api ×3  500M each │ redpanda 250M │ postgres 120M
minio 97M │ nginx 39M │ web 39M │ redis 4M
```
Each api replica is capped at 1 GB (`MaxRAMPercentage` is a share of the *container*
limit — unset, three JVMs each size for the whole host and the box thrashes).

---

## 2. Layout — three repos, one box

```
platform/        everything stateful: postgres, minio, redis-shush, redpanda,
                 elasticsearch, nginx (the only public port)
observability/   prometheus + grafana. Not currently deployed on this box.
shush-chat/      this repo: 3 stateless api replicas + the Next.js web container
```

Two Docker networks, both created by `platform/bootstrap.sh`:

```
syamdev-edge    nginx  <-> apps          the public path
syamdev-data    apps   <-> datastores    internal only, never reachable from outside
```

Credentials live in **each repo's own gitignored `.env`**. Ten values appear in both
`platform/.env` and `shush-chat/.env` and **must match** — they are the two halves of one
credential, marked `# shared` in both `.env.example` files. Rotate one, rotate both.

---

## 3. Routine deploy — the 90% case

```bash
ssh syam-hetzner
cd /root/shush-chat
git pull                                                  # origin is https, no deploy key needed

# Rebuilds the image and recreates the three replicas. Flyway runs any new migration
# on startup -- see §4 before deploying anything that adds one.
docker compose --env-file .env -f compose.platform.yaml up -d --build

# REQUIRED after any replica rebuild. nginx resolves the `upstream shush-api` block once
# at startup; new containers get new IPs and every request 502s until nginx restarts.
docker compose --env-file /root/platform/.env -f /root/platform/edge/compose.yaml restart nginx

docker compose --env-file .env -f compose.platform.yaml ps    # all three healthy?
curl -sf https://shushchat.syamdev.site/api/health            # {"status":"UP"}
```

Frontend only — faster, and needs no nginx restart (`/` is proxied through a `set`
variable with Docker's resolver, so that one name *is* re-resolved per request):

```bash
cd /root/shush-chat && git pull
docker compose --env-file .env -f compose.platform.yaml up -d --build web
```

Platform config only (nginx vhosts, a new tenant):

```bash
cd /root/platform && git pull
docker compose -f edge/compose.yaml exec nginx nginx -t     # validate BEFORE reloading
docker compose -f edge/compose.yaml exec nginx nginx -s reload
```

---

## 4. Migrations

Flyway applies pending migrations **automatically when a replica starts**, so deploying
*is* applying. There is no separate step and no way to deploy the code without the schema.

```bash
# 1. ALWAYS dump first. Name it for the version you are about to apply.
docker exec syamdev-data-postgres-1 sh -c 'pg_dump -U $POSTGRES_USER shush' \
  > ~/shush-before-v12.sql

# 2. Deploy as in §3.

# 3. Confirm the version landed.
docker exec syamdev-data-postgres-1 sh -c \
  'psql -U $POSTGRES_USER -d shush -Atc "select max(version::int) from flyway_schema_history"'
```

Rules: migrations are **forward-only**. An applied file is never edited — add the next
one. `ddl-auto` is `validate`; Flyway owns the schema, Hibernate only checks it agrees.

---

## 5. First-time bring-up, or after a rebuild of the box

Order matters: nginx refuses to start while its upstream names do not resolve, so the
app stack comes up **before** the edge.

```bash
cd /root/platform
cp .env.example .env && vi .env          # fill every value
./bootstrap.sh                           # creates syamdev-edge and syamdev-data, once

docker compose --env-file .env -f data/compose.yaml      up -d   # postgres, minio, redis-shush
docker compose --env-file .env -f streaming/compose.yaml up -d   # redpanda
docker compose --env-file .env -f search/compose.yaml    up -d   # elasticsearch
# Provisioning containers run on every `up` and are idempotent: they create the per-tenant
# database, bucket, SASL user and ES role, then exit.

cd /root/shush-chat
cp .env.example .env && vi .env          # the ten `# shared` values must match platform/.env
docker compose --env-file .env -f compose.platform.yaml up -d --build

cd /root/platform
docker compose --env-file .env -f edge/compose.yaml up -d        # nginx last

./verify-isolation.sh                    # attempts cross-tenant access; must pass
```

Values that differ from the `.env.example` defaults on this box:

```bash
NGINX_BIND=0.0.0.0     HTTP_PORT=80              # public; the default is loopback:8081
SHUSH_S3_PUBLIC_ENDPOINT=https://shushchat.syamdev.site   # NOT minio:9000 -- SigV4 signs the
                                                          # Host, so the browser must be given
                                                          # the URL it will actually call
SHUSH_DEV_ENDPOINTS=false                                 # conversation-creation bypass, off
```

---

## 6. TLS

Already issued and auto-renewing — `syamdev-edge-certbot-1` runs the renew loop every 12 h.
Nothing to do unless the domain changes.

```bash
cd /root/platform

# Check expiry.
docker compose --env-file .env -f edge/compose.yaml run --rm --entrypoint certbot \
  certbot certificates

# Issue for a NEW domain (nginx must already be serving :80 for the webroot challenge).
docker compose --env-file .env -f edge/compose.yaml run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot -d <domain> \
  --email syamsribalaji@gmail.com --agree-tos --no-eff-email

docker compose --env-file .env -f edge/compose.yaml --profile tls up -d   # start the renew loop
```

nginx writes a throwaway self-signed cert at the expected path when none exists, so the
config loads on a fresh box rather than refusing to start.

---

## 7. Reaching the datastores from a laptop

No database port is ever internet-facing. SSH is the tunnel.

```bash
ssh -N \
  -L 15432:127.0.0.1:55432 \   # postgres   (55432 on the host: a native pg owns 5432)
  -L 16379:127.0.0.1:16379 \   # redis-shush
  -L 19092:127.0.0.1:19092 \   # redpanda kafka
  -L 19644:127.0.0.1:19644 \   # redpanda admin
  -L 19200:127.0.0.1:9200  \   # elasticsearch
  -L 19000:127.0.0.1:9000  \   # minio api
  -L 19001:127.0.0.1:9001  \   # minio console
  -L 13001:127.0.0.1:3001  \   # grafana      (only if observability is deployed)
  -L 19090:127.0.0.1:9090  \   # prometheus   (same)
  syam-hetzner
```

Or an `~/.ssh/config` block, so it is `ssh -N syam-hetzner-tunnel`:

```
Host syam-hetzner-tunnel
    HostName <same as syam-hetzner>
    User root
    IdentityFile <same as syam-hetzner>
    LocalForward 15432 127.0.0.1:55432
    LocalForward 16379 127.0.0.1:16379
    LocalForward 19092 127.0.0.1:19092
    LocalForward 19644 127.0.0.1:19644
    LocalForward 19200 127.0.0.1:9200
    LocalForward 19000 127.0.0.1:9000
    LocalForward 19001 127.0.0.1:9001
    LocalForward 13001 127.0.0.1:3001
    LocalForward 19090 127.0.0.1:9090
```

---

## 8. Observability (optional, not currently running here)

```bash
cd /root/observability
docker compose --env-file .env -f compose.yaml up -d      # grafana :3001, prometheus :9090
```

Targets are **discovered** from Docker labels (`metrics.scrape=true` on the api services in
`compose.platform.yaml`), so that repo never learns this one exists. Costs ~400 MB, which is
why it is off on a 7.6 GB box with no swap.

---

## 9. Diagnosing

```bash
docker compose --env-file .env -f compose.platform.yaml logs -f --tail=100 api-1
docker compose --env-file .env -f compose.platform.yaml logs -f web
docker compose --env-file /root/platform/.env -f /root/platform/edge/compose.yaml logs --tail=50 nginx

curl -sf https://shushchat.syamdev.site/api/health          # liveness, no I/O
curl -sf https://shushchat.syamdev.site/api/health/ready     # checks postgres + redis
docker stats --no-stream                                     # memory, against §1's budget
docker ps --format '{{.Names}}\t{{.Status}}'
```

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every request 502 right after a deploy | nginx cached the old replica IPs | restart nginx (§3) |
| `Photo unavailable` on every image | `/shush-media/` route or `SHUSH_S3_PUBLIC_ENDPOINT` | must be the site URL, and the route must allow GET as well as PUT |
| Websocket never connects, HTTP fine | proxy forwarded `$host` (drops the port) so the app judged itself cross-origin | `$http_host` everywhere in `shush.conf` |
| A tenant's auth breaks after a rotation | the ten `# shared` values drifted | re-match `platform/.env` and `shush-chat/.env` |
| Box thrashing, broker stalling, looks like message loss | a container without a memory limit | every app service needs `deploy.resources.limits.memory` |

---

## 10. Rollback

```bash
cd /root/shush-chat
git log --oneline -5
git checkout <sha>
docker compose --env-file .env -f compose.platform.yaml up -d --build
docker compose --env-file /root/platform/.env -f /root/platform/edge/compose.yaml restart nginx
```

**Code rolls back; the schema does not.** Migrations are forward-only, so an older image
must still validate against the newer schema — if it cannot, restore the dump from §4.

---

## 11. Open items

- **MinIO publishes `0.0.0.0:9000-9001` and `ufw` is inactive.** It no longer needs to be
  public — image bytes go through nginx's `/shush-media/` route since the presigned-URL fix.
  Setting `MINIO_BIND=127.0.0.1` in `platform/.env` and restarting the data stack closes the
  API and console to the internet. Worth doing.
- **No swap.** A memory spike is an OOM kill, not a slowdown. Deliberate — swap would hide
  the exact pressure the memory limits exist to make visible — but it is why §1's budget
  matters before adding a container.
- **The benchmark on dedicated hardware has not been run.** The numbers in the
  [root README](../README.md) §5 are laptop figures, labelled there as evidence that the
  invariants hold rather than as a throughput claim. A real one needs the load generator on a
  second machine — sharing CPU with the system measures the load generator.
