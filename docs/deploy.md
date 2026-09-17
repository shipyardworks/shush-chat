# Shush — Deployment Plan

> Companion to `aim.md`. Covers where Shush runs, what it costs, and the concrete steps
> for each hosting path. Read `aim.md` §5 first for the stack and the memory budget.

---

## 1. Current state

### 1.1 The existing box

| Property | Value |
|---|---|
| Instance | `t4g.small` — AWS EC2 |
| Architecture | **ARM64 (Graviton2)** |
| Resources | 2 vCPU, 2 GB RAM, 19 GB gp3 |
| Region | `ap-southeast-1a` (Singapore) |
| OS | Ubuntu 24.04 |
| Free memory | **~1 GB, already swapping** (227 MB into a 2 GB swapfile) |
| Free disk | 9 GB of 19 GB — **~3.35 GB reclaimable** via `docker builder prune` |

Currently running: `nginx` + `certbot` (shared ingress, `edge` network),
`linkedin_profile_api` (web + api + worker, ~175 MB), and the PPE static site served
off disk by nginx.

### 1.2 Billing position

The account is on **AWS signup credits**, not cash. This is a deadline, not a bill.

**Action — do this first:** open Billing → Credits and record:

- Remaining credit balance
- **Credit expiry date** ← this is the real deadline

When credits lapse, the box costs approximately:

| Line item | Monthly |
|---|---|
| `t4g.small` — $0.0212/hr × 730 | ~₹1,360 |
| 19 GB gp3 EBS | ~₹160 |
| Data transfer (first 100 GB/mo free) | ~₹0 |
| **Total** | **~₹1,520/month** |

Set a billing alert at ₹100 so the credits-to-cash transition is not a surprise.

### 1.3 Constraints that shape everything below

1. **2 GB RAM cannot host the stack.** The full stack needs ~4.6 GB tuned, ~5 GB with
   headroom. See `aim.md` §5.3. This is arithmetic, not tuning.
2. **ARM64 everywhere.** Images built on WSL (x86_64) will not run. See §5 below.
3. **No confirmed international card.** Both AWS and OCI require one for verification.
   Since an AWS account already exists, a working card almost certainly already exists.
4. **Benchmark numbers are region-independent.** They are measured server-side with the
   load generator in the same AZ. Hosting region affects only the *live demo's feel*,
   never the resume claim.

---

## 2. The three environments — never conflate them

| Environment | Where | Purpose | Required? |
|---|---|---|---|
| **Dev + reviewer** | Laptop, `docker compose up` | R7 — the primary deliverable | **Yes** |
| **Benchmark** | EC2, temporarily resized | R2/R3 — numbers and invariant proofs | **Yes** |
| **Live demo** | AWS or OCI, 24/7 | Optional upside | **No** |

**The live demo is not required and is not the plan.** The README with benchmark
results and a recorded demo is the deliverable. Hosting is upside if it is free; it is
not worth ₹5,000/month, and a broken link during a job search is worse than no link.

---

## 3. Benchmark run — required, ~₹100, either path

This happens regardless of hosting decisions. AWS permits changing the instance type of
a **stopped** instance at no cost, preserving the EBS volume, nginx config, and
certificates.

```
1. docker builder prune              # reclaim ~3.35 GB first
2. (optional) grow EBS 19 GB → 30 GB # ~₹250/month while it lasts
3. Stop instance
4. Change type: t4g.small → t4g.2xlarge   (8 vCPU, 32 GB)
5. Start; run the full stack + benchmark suite
6. Capture: results table, Grafana screenshots, harness output
7. Stop; change type back to t4g.small; start
```

`t4g.2xlarge` in `ap-southeast-1` is ~$0.34/hr. Three hours is under ₹100 — and while
credits last, ₹0.

**Methodology requirement:** run the load generator on a **separate instance in the same
AZ**. Sharing CPU with the server means measuring the load generator, not the system. A
spot `t4g.medium` for an hour costs pennies. State this in the README — it is what makes
the benchmark credible.

**Capture everything before resizing back.** Screenshots, raw output, `nproc`, `free -h`,
instance type, and kernel version all belong in the README. Re-running a benchmark
because the numbers were not recorded properly is a wasted evening.

---

## 4. Hosting paths

### Path A — AWS only, no 24/7 hosting *(default; assume this unless B succeeds)*

Keep the `t4g.small` for existing apps. Shush is never permanently hosted.

- Dev and review happen on the laptop (R7)
- Benchmarks happen via §3
- The demo is a **recorded 60–90 second capture** embedded in the README

**Record this specific sequence**, because it is more convincing than a live link — a
visitor would never think to trigger the failure case themselves:

1. Two browser windows, messages flowing in real time
2. `docker kill shush-api-2` mid-conversation
3. Messages continue, in order, with no duplicates and no visible interruption
4. Cut to the harness output asserting zero reordering / zero duplicates

**Cost: ₹0. Risk: none.** Nothing can break during the job search.

### Path B — Oracle Cloud Always Free *(attempt this; it dominates if it works)*

Always Free gives **4 ARM Ampere cores + 24 GB RAM**, permanently, plus 200 GB block
storage and 10 TB/month egress. That is 12× the current memory at zero cost, and it is
ARM — so the existing build pipeline carries over unchanged.

If it works, it hosts nginx, certbot, `linkedin_profile_api`, the PPE site, *and* the
full Shush stack, and the AWS box can be terminated — saving ₹1,520/month from credit
expiry onward.

#### B.1 Signup — the irreversible decision

**The home region is chosen at signup and can never be changed.** Always Free compute
must live in the home region, so "sign up, then shop for capacity" is not available.
Choose deliberately:

| Region | RTT from Bangalore | Note |
|---|---|---|
| `ap-hyderabad-1` | 20–30 ms | **First choice** — newer, less contested than Mumbai |
| `ap-mumbai-1` | 10–20 ms | Best latency, heavily contested for A1 |
| `ap-singapore-1` | 40–60 ms | Matches existing AWS footprint |

Do not choose a distant region for capacity. Shush's entire claim is *real-time*
messaging; a demo at 250 ms RTT undercuts it regardless of what the benchmark says.

**A1 availability by region fluctuates constantly.** Treat any specific claim — including
this table's ordering — as a hypothesis. The only reliable test is trying.

#### B.2 Upgrade to Pay As You Go immediately

This is the single biggest lever, and it costs ₹0 while staying inside Always Free limits.

1. **A1 capacity priority.** Oracle allocates ARM capacity preferentially to PAYG
   accounts. Free-tier accounts are deprioritized — this is the main reason people never
   get an instance.
2. **Exemption from idle reclamation.** See §6.

Set a ₹0 budget alert immediately after upgrading.

#### B.3 Launch and verify

Target shape: `VM.Standard.A1.Flex`, **4 OCPU / 24 GB**.

On "Out of host capacity," retry over several days — capacity frees irregularly. Give it
a week before concluding it will not happen.

**The OCI networking trap:** opening a port requires **two** changes, not one.

1. The Security List / NSG in the OCI console
2. The instance's own iptables — OCI's Ubuntu images ship restrictive rules persisted in
   `/etc/iptables/rules.v4`

Port 80 stays closed after fixing only the cloud-side firewall. Everyone hits this;
almost nobody expects it.

#### B.4 Migrate incrementally — never all at once

1. Install Docker; recreate the `edge` network and the `syamdev-infra` ingress pattern
2. Point **one** subdomain at the new box: `shush.syamdev.site` → OCI public IP
3. Issue certificates via certbot (Let's Encrypt works identically anywhere)
4. Deploy the full Shush stack; leave everything else on AWS
5. **Run it for a month.** Watch for reclamation notices or account issues
6. Only then migrate `linkedin_profile_api` and the PPE site
7. Terminate the AWS instance only after DNS has fully propagated and been verified

Rolling back at any step before 7 is a DNS change. After step 7 it is a rebuild — so do
not rush step 7.

**Known risk:** OCI has a reputation for occasionally closing free accounts with little
explanation. Keep backups. Do not put anything irreplaceable there.

---

## 5. ARM64 — the build trap

Development is on Windows/WSL (x86_64). Both target boxes are aarch64. **Images built
locally will not run** — they fail with `exec format error`.

Either build on the server, or cross-build:

```bash
docker buildx build --platform linux/arm64 -t shush-api:latest .
```

Everything else in the stack ships multi-arch: Postgres, Redis, Redpanda,
Elasticsearch 8, MinIO, Prometheus, Grafana, Temurin 21. The one casualty is Confluent's
`cp-kafka`, whose arm64 support is patchy — one of the reasons `aim.md` §4.2 selected
Redpanda.

---

## 6. OCI idle reclamation — facts

Oracle deems an Always Free instance idle when, over a 7-day window, **all three** hold:

- 95th-percentile CPU utilization **< 10%**
- Network utilization **< 10%**
- Memory utilization **< 10%** (A1 shapes only)

**It is an AND.** Failing any one criterion is sufficient to be safe.

The Shush stack clears it on memory alone:

```
~4.6 GB resident / 24 GB total = ~19%   →  comfortably above 10%
```

CPU will sit at 3–5% with no users and network near zero, but memory carries it.

**Do not run a synthetic load generator to defeat this.** It is unnecessary (19% already
clears the bar), it wastes memory wanted for heap dumps and benchmark headroom, and the
legitimate fix — PAYG (§B.2) — removes idle reclamation entirely.

The one case that needs attention: if the stack is trimmed hard — dropping Elasticsearch
in favour of a Postgres GIN index — resident memory falls to roughly 2.4 GB, or exactly
10%. If that happens, raise a JVM's `-Xms` rather than adding a decoy process. Same
effect, real allocation the application can use.

---

## 7. nginx changes required for Shush

Three issues in the existing `syamdev-infra` config will affect this project. Full
reasoning in `aim.md` §5.5.

1. **`worker_connections 1024` caps concurrency near 512 WebSockets** — about 5% of the
   10k target, because each proxied socket consumes two file descriptors. Needs
   `worker_connections 20480` plus a matching `ulimit -n`. **Fails silently**, appearing
   as an unexplained plateau in the load test. Fix before the first benchmark run.
2. **`proxy_read_timeout 60s` kills idle WebSockets.** Needs `3600s` on the Shush
   location, *plus* an application-level ping/pong under 60s. Do both.
3. **Load balancing must use `least_conn`, not round-robin.** WebSocket connections are
   long-lived and disconnect unevenly; round-robin balances at assignment time and drifts.

Two notes for the README rather than the config:

- **No `ip_hash` or sticky sessions are needed** — say so explicitly under R5. That is
  what the §3.3 backplane buys: any node serves any user because routing goes through
  Redis/Kafka, not connection affinity. Most implementations reach for sticky sessions;
  explaining why this one does not is a strong design decision.
- `client_max_body_size 20m` is irrelevant here, which confirms the §3.5 presigned-URL
  design: media bytes bypass nginx and the API entirely.

Also fix, since the snippet is shared with other apps: `Connection "upgrade"` is
hardcoded in `snippets/proxy.conf`, sending a spurious header on plain HTTP requests. The
canonical form is a `map $http_upgrade $connection_upgrade` block.

---

## 8. Accessing services — SSH tunnels, never public ports

Publish infrastructure ports to **loopback only**:

```yaml
ports:
  - "127.0.0.1:5432:5432"    # correct
  # - "5432:5432"            # WRONG — binds 0.0.0.0, public internet
```

Docker's default form binds `0.0.0.0` and **writes directly into iptables' DOCKER chain,
bypassing UFW**. The firewall will look correctly configured while the port is open to
the world. An exposed Redis or Postgres is found by scanners within hours.

Reach them over SSH instead. This table is the actual, current port list across the three
`platform`/`streaming`/`search`/`edge` folders plus `observability` — it superseded an earlier,
generic 4-port version of this section that predated the multi-repo split and had gone stale
(it even listed Redis, which at the time published no host port at all to forward to):

| Service | Host port (loopback) | Repo |
| --- | --- | --- |
| Postgres | `55432` | `platform/data` |
| Redis (`redis-shush`) | `16379` | `platform/data` |
| Redpanda (Kafka) | `19092` | `platform/streaming` |
| Redpanda admin | `19644` | `platform/streaming` |
| Elasticsearch | `9200` | `platform/search` |
| MinIO API | `9000` | `platform/data` |
| MinIO console | `9001` | `platform/data` |
| Grafana | `3001` | `observability` |
| Prometheus | `9090` | `observability` |

One command, matching the local-port choices already in use for this box:

```bash
ssh -N \
  -L 15432:127.0.0.1:55432 \
  -L 16379:127.0.0.1:16379 \
  -L 19092:127.0.0.1:19092 \
  -L 19644:127.0.0.1:19644 \
  -L 19200:127.0.0.1:9200 \
  -L 19000:127.0.0.1:9000 \
  -L 19001:127.0.0.1:9001 \
  -L 13001:127.0.0.1:3001 \
  -L 19090:127.0.0.1:9090 \
  syam-hetzner
```

Or as an `~/.ssh/config` block for the same host, so it's just `ssh -N syam-hetzner-tunnel`:

```
Host syam-hetzner-tunnel
    HostName <same as syam-hetzner>
    User <same as syam-hetzner>
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

Then DBeaver, `redis-cli -p 16379`, and Grafana on `localhost:13001` all work locally. No
database port is ever internet-facing; SSH is the authenticated tunnel. Redis now publishes a
host port the same way every other datastore here already did — it never had one before, which
is the whole reason it couldn't be tunneled.

---

## 9. Cost summary

| Scenario | ₹/month |
|---|---|
| **Path A** — AWS, no hosting, recorded demo | **₹0** *(₹1,520 for the existing box after credits lapse)* |
| **Path B** — OCI Always Free, AWS terminated | **₹0** |
| Benchmark run (one-time, either path) | ~₹100 |
| *Rejected:* AWS `t4g.large` 8 GB, 24/7 | ~₹5,700 |
| *Rejected:* AWS `t4g.xlarge` 16 GB, 24/7 | ~₹11,150 |

Paid 24/7 hosting is rejected on value, not affordability: ~₹34,000 over six months for a
demo whose marginal value over a good README and a recorded capture is close to zero —
and which introduces the risk of a broken link mid-search.

---

## 10. Decision gate

```
Check AWS credit expiry date
        │
        ▼
Attempt OCI signup → Hyderabad → upgrade to PAYG
        │
        ├── A1 capacity within ~1 week?
        │        │
        │       YES ──► Path B: migrate incrementally (§B.4)
        │        │              Live demo becomes free. Terminate AWS after 1 month.
        │        │
        │        NO ──► Path A: recorded demo, no hosting
        │                       Revisit before credits expire
        │
        ▼
Either way: benchmark via §3, README is the deliverable
```

**What does not change on either path:** the benchmark runs on a temporarily-resized
instance and is region-independent; the README with results and a recorded demo is the
primary deliverable; and live hosting is upside, never the plan.
