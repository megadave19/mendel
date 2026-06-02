# V3_PLAN.md — Mendel v3 Development Plan (Cloud)

> Companion to PRD.md / TRD.md / DESIGN.md / CLAUDE.md, mirroring V2_PLAN.md.
> **Read this before any v3 work.** v3 is a *deployment + multi-tenancy* project,
> not a rewrite — v2 was built cloud-ready on purpose (nullable `tenantId`,
> `SandboxProvider` interface, pure policy layers).
>
> **Status:** PROPOSED — awaiting owner sign-off on §11 spec amendments before code.

---

## 0. How to read this

- v3 turns Mendel from a **single-user local app** into a **multi-tenant hosted product**.
- The hard new problem is **NOT features — it's isolation + data-loss prevention.** Many strangers' GitHub PATs and scan data sit in one shared database. A single cross-tenant leak is a product-ending incident. §7 is the most important section in this file.
- We stay **free-tier-first**: the cloud control plane (UI, DB, auth, `/inspect`) runs at ~$0; the only component that costs real money is the **hosted sandbox**, which we defer until there are users + budget. Compute stays on **local Docker** until then (your decision, 2026-06).
- Every v2/v1.x guardrail still binds. v3 *adds* rules; it removes none.

---

## 1. Executive summary

| Decision | Choice | Why |
|---|---|---|
| **DB engine** | **Postgres** (keep — Prisma already supports it) | Standard cloud DB; multi-tenant-capable; Prisma swap from SQLite is config-level. Supabase *is* Postgres, so this isn't Postgres-vs-Supabase. |
| **DB host** | **Supabase** (chosen) — Postgres, interchangeable via Prisma | Owner pick (2026-06). Bundled Postgres + auth + storage + dashboard; generous free tier. Engine stays Postgres so a later swap to Neon is config-only. **Caveat to verify (§9):** Supabase free DB pauses after ~1wk idle — confirm acceptable for the demo or use a keep-alive ping. |
| **Auth** | **NextAuth.js + GitHub OAuth** (replaces PAT-session) | Free, battle-tested, GitHub-native (Mendel is a GitHub tool — users already have accounts). |
| **Compute (now)** | **Local Docker** behind existing `SandboxProvider` | Free. No users yet → no need to pay for hosted sandbox. |
| **Compute (future)** | **Hosted sandbox seam reserved** (E2B / Fly) | Wired as an empty provider slot; turned on only when users + budget exist. |
| **Hosting** | **Vercel** (Hobby free → Pro when commercial) | Next.js-native, the framework we already use. |
| **Tenant isolation** | **Postgres Row-Level Security (RLS) + app-layer tenant scoping (defense-in-depth)** | The single most important data-loss/leak control. Two independent layers. |

**Headline:** A hosted, multi-tenant Mendel where strangers log in with GitHub, scan their repos, and never — under any bug — see another tenant's data or PAT. Runs ~free until real scan volume forces the hosted-sandbox spend.

---

## 2. Guiding principles (cross-cutting)

### 2.1 Tenant isolation is the new honesty floor
v1.5 had §5b (honest framing). v2 had §5c (honest action). **v3 adds §5d (proposed): tenant isolation.** Every row is owned by exactly one tenant; no query, no API route, no worker, no MCP tool may ever return a row it doesn't own. Enforced at **two** layers (RLS + app scoping) so a single-layer bug can't leak. This is non-negotiable and §7 details it.

### 2.2 Free-tier-first, no-rewrite
We ship the cloud **control plane** (everything except the paid sandbox) first, on free tiers. The `SandboxProvider` interface means turning on hosted compute later is a config change, not a rewrite. Nothing in v3.0/v3.1 may assume the sandbox is local *or* hosted in a way that forces a later rewrite — same discipline v2 applied for v3.

### 2.3 Secrets never widen their blast radius
A PAT leak in single-user local = one user. A PAT leak in multi-tenant cloud = **every user**. So secret-handling rules get *stricter*, not looser: PATs stay AES-256-GCM-encrypted at rest, decrypted only in-memory at use, never logged, never returned in any API/MCP response, never in client bundles, scoped to their owning tenant on every read.

### 2.4 Design system is locked; we extend, never reinvent
New surfaces (login, account, tenant dashboard) reuse DESIGN.md §5 tokens, §6 type, §7 motion, §8 Bones (no new poses), §12 component inventory. Cyberpunk-CRT stays. Each new screen gets a §11c brief (proposed) before build, audited per CLAUDE.md §7.2 step 6.

### 2.5 Every v1.x/v2 lesson still guards
§11c data-first debugging, §11b real-fixture verification, §7.2a dead-control/decorative-data rules, the eval bench as calibration anchor — all still apply. v3 adds **tenant-isolation tests** as a new mandatory test class (§9).

---

## 3. Architecture shift (local → cloud)

### What moves to the cloud
| Component | v2 (local) | v3 (cloud) |
|---|---|---|
| UI (Next.js) | localhost:3000 | Vercel |
| Database | SQLite file | Postgres (Neon/Supabase) + RLS |
| Auth | PAT pasted into local Settings | GitHub OAuth (NextAuth), httpOnly session cookies |
| PR-state poller | local cron | Vercel Cron / hosted queue |
| `/inspect` (F22) | local | **cloud, runs for real — needs no sandbox** |
| Scan history / dashboards | local SQLite reads | cloud Postgres reads (tenant-scoped) |

### What stays local (for now)
| Component | Why |
|---|---|
| **The sandbox** (clone + install + test + smoke) | Heavy compute; hosted = $. Deferred. Runs on the user's machine via the local-runner bridge (F32) until v3.2. |

### The honest architectural consequence
A Vercel function **cannot reach a stranger's local Docker** over the internet. So full scans in v3.0/v3.1 use a **BYO-compute model**: the cloud is the *control plane* (queue, history, UI, auth); the user runs a small local **Mendel runner** (`pnpm runner`) that authenticates to the cloud, pulls *their own* queued scans, executes them in *their* local Docker, and pushes results back. This is exactly how GitHub self-hosted runners + CI agents work. It keeps compute free and — critically — means **a user's PAT can stay on their own machine** for the actual git/clone operations, shrinking the cloud's secret blast radius.

`/inspect` (F22) is the exception that shines here: it's pure analysis (download two package versions, diff their APIs) — **no repo clone, no sandbox** — so it runs **fully in the cloud, for free, today.** It's the cheapest cloud demo surface: a prospect signs in with GitHub (one click) and gets a real calibrated analysis. **Login-gated (owner decision):** the one-click GitHub sign-in is low friction for devs, and — crucially — **every `/inspect` user becomes a known, captured lead** rather than an anonymous hit, plus per-tenant rate limits become enforceable.

---

## 4. Release sequencing & dependency rationale

| Release | Theme | Features | Cost | Gate (half-day, CLAUDE.md §7.3) |
|---|---|---|---|---|
| **v3.0** | Cloud control plane | F27 auth · F28 multi-tenant + RLS · F29 deploy + security headers · F30 hosted Postgres + backups · F31 `/inspect` live · F34 observability core | **free** | Two tenants cannot see each other's data (RLS + app-layer, proven by isolation tests); `/inspect` works on the deployed URL; deploy checklist (§7) green |
| **v3.1** | BYO-compute scans | F32 local-runner bridge (`RemoteSandboxProvider` consuming a tenant-scoped queue) | **free** | A user runs `pnpm runner`, the cloud queues a scan, the local runner executes + pushes a real result; PAT never leaves the user's machine for clone ops |
| **v3.2** | Hosted sandbox (opt-in) | F33 hosted `SandboxProvider` (E2B / Fly) behind the v2 interface | **paid, on-demand** | A full scan runs end-to-end in the cloud sandbox with §11b.1 real-container egress test on the hosted provider |
| **v3.3** | Ship & prove | F35 security audit + Loom + case study + ≥3 real cloud scans | — | External security checklist passes; Loom recorded; case study updated |

**Sequencing rationale:** isolation (F28) is the foundation everything else sits on, so it lands first with auth. `/inspect`-live (F31) is the cheapest possible proof the cloud works and the best marketing surface, so it ships in v3.0. Full scans split into free (F32 BYO-compute) and paid (F33 hosted) so money is spent only when justified.

---

## 5. Detailed feature plans (F27–F35)

### F27 — Auth: NextAuth + GitHub OAuth
- Replace the PAT-session model with **Sign in with GitHub** (NextAuth.js, GitHub provider).
- Session in **httpOnly, Secure, SameSite=Lax cookie** — never localStorage (CLAUDE.md §11 / security-rule 4).
- On first login, create a `Tenant` row keyed to the GitHub user id; every subsequent row the user creates carries `tenantId`.
- The GitHub OAuth token (for cloning/PRs) is **encrypted at rest** like the PAT was; for BYO-compute (F32) it can stay on the runner.
- Account lockout / abuse: NextAuth + per-IP rate limit on the callback (security-rule 2).
- **Honesty:** the consent screen states exactly which GitHub scopes Mendel requests and why (`repo`, `read:user`), and that PATs/tokens are encrypted + never shown back.

### F28 — Multi-tenant data model + RLS (the foundation)
- Every model's `tenantId` flips from **nullable** (v2 cloud-readiness seam) to **NOT NULL**, FK → `Tenant`.
- **Postgres Row-Level Security (RLS)** policies on every tenant-owned table: `USING (tenant_id = current_setting('app.tenant_id'))`. The app sets `app.tenant_id` per request from the verified session — so even a buggy/forgotten `WHERE` clause can't cross tenants (the DB refuses).
- **App-layer defense-in-depth:** a Prisma middleware/extension injects `tenantId` into every `where` + every `create`. RLS is the backstop; app-scoping is the first line. **Both**, because one alone is one bug from a leak.
- Migration: `prisma migrate` (v3 graduates from `prisma db push` to versioned migrations — multi-tenant prod needs auditable schema history).

### F29 — Cloud deploy + security headers
- Vercel deploy; `vercel.ts` config.
- **Security headers via middleware** (security-rule 7): CSP (no `unsafe-inline` scripts), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, remove `X-Powered-By`.
- **CORS** (security-rule 6): explicit allowed origin (the deployed domain), no `*`, `credentials: true`.
- HTTPS enforced (Vercel default).

### F30 — Hosted Postgres + data-loss prevention
- Neon (or Supabase) Postgres; Prisma datasource swap from `sqlite` → `postgresql`.
- **Connection pooling** (Neon pooler / PgBouncer) — Vercel functions are many short-lived connections.
- **Backups = the data-loss control:** enable automated daily backups + point-in-time recovery (Neon branching / Supabase PITR). Document the restore runbook. A dropped table or bad migration must be recoverable.
- DB user has **least privilege** (security-rule 5): the app role can CRUD app tables, cannot DROP/ALTER outside migrations.
- DB **not publicly exposed** — accessed via pooled connection string from the app only (deploy-checklist).

### F31 — `/inspect` live in the cloud (free demo surface)
- F22's inspect orchestrator is **pure analysis** — no clone, no sandbox. Runs in a Vercel function directly.
- **Login-gated** (GitHub OAuth): a user must sign in before running an inspection. One-click for devs; turns every use into a captured lead + makes per-tenant limits enforceable.
- Per-tenant rate-limited (security-rule 2: 10/min) + LLM-token-budgeted (AI rule) since it calls the LLM + registries.
- This is the cheapest cloud demo of Mendel's calibration, at ~$0 (no sandbox).

### F32 — Local-runner bridge (BYO-compute, free full scans)
- New `RemoteSandboxProvider` implementing the v2 `SandboxProvider` interface, but instead of running Docker directly it **enqueues** the scan to a tenant-scoped queue.
- A local `pnpm runner` process (the user runs it on their machine): authenticates to the cloud with a scoped runner token, long-polls *its own tenant's* queue, runs the scan in **local Docker** (the existing executor, unchanged), streams results back over the same SSE shape the UI already consumes.
- **Security:** the runner token is tenant-scoped + revocable; a runner can only ever pull *its own* tenant's jobs (RLS-enforced server-side). The user's PAT can live on the runner, never in the cloud, for the actual clone/PR — shrinking the cloud blast radius.

### F33 — Hosted sandbox provider (paid, opt-in, future)
- Second `SandboxProvider` impl: E2B or Fly machines.
- Same three-phase contract (install/bridge+iptables, test/none, smoke/none), same per-language images, same §11b.1 **real-container egress test on the hosted provider** before trust.
- Gated behind a per-tenant flag + budget guardrail (hard cap on sandbox-minutes/tenant to prevent a cost-attack — extends the AI token-budget rule to compute).

### F34 — Observability + abuse protection
- **Sentry** for error tracking (server-side; scrub PATs/tokens from breadcrumbs — security-rule 9: no secrets in logs).
- **Per-tenant rate limits** (Upstash Redis or Vercel KV counters): general 60/min, auth 5/15min, scan 10/min, LLM 10/min (security-rule 2 + AI rule).
- **Per-tenant LLM token budgets** + sandbox-minute budgets — detect + stop cost-attacks (AI rule).
- **Audit log** (extends the v2 `AgentLog`): tenant-scoped record of logins, scans, PRs, auto-merges, settings changes — for incident forensics.

### F35 — Ship & prove
- External security checklist (the 12-point table, §7) signed off pre-launch.
- Loom (cloud edition) + case study covering the local→cloud journey + the isolation model.
- ≥3 real scans by ≥2 distinct test tenants, proving isolation in the wild.

---

## 6. UI/UX & design integration (DESIGN.md-locked)

New surfaces, each reusing the cyberpunk-CRT system — **proposed DESIGN.md §11c briefs:**
- **S0 — Sign in with GitHub:** single CRT-framed panel, Bones idle, the lime OAuth button, explicit scope-disclosure copy. Reuses PanelFrame + ScanlineOverlay. No new mascot pose.
- **S13 — Account / Tenant:** the user's identity, connected GitHub, runner-token management (F32), danger-zone (delete account → cascades tenant data). Nixtio-density, not 80% empty.
- **S14 — Runner status:** "is your local runner connected?" live indicator + `pnpm runner` setup copy. Honest states: connected / disconnected / scan-in-flight.

(Screen numbers avoid the v2 §11b collisions: S10 Inspector, S11 Watchlist, S12 Eval are taken. See DESIGN.md §11c.)
- Existing screens (Dashboard, Live Console, Settings, Inspect) gain a tenant header chip but otherwise unchanged — they were built tenant-agnostic.

Rules that still bind: no dead controls (§7.2a), no decorative-only data viz, one Bones per screen, mandatory `/dev/[component]` build-in-isolation + spec-conformance audit before "done."

---

## 7. Security & data-loss prevention (THE section)

This maps your 12-point security checklist + AI rules directly onto v3, plus the multi-tenant additions. **Proposed as CLAUDE.md §5d.**

| # | Checklist item | v3 implementation |
|---|---|---|
| 1 | **Exposed secrets** | All secrets in Vercel env (not `.env` in repo). `.gitignore` covers `.env*`. No secret in any `NEXT_PUBLIC_`. PATs/OAuth tokens AES-256-GCM at rest, never in API/MCP responses, never in client bundles. `.env.example` lists names only. |
| 2 | **Rate limiting** | Per-tenant + per-IP via Upstash/KV. Auth 5/15min, general 60/min, scan 10/min, LLM 10/min, inspect 10/min. `429 + Retry-After`. |
| 3 | **Input validation** | Zod at every API route, worker input, MCP tool, OAuth callback. Server-side only. Prisma parameterized (no raw SQL). |
| 4 | **Auth & authz** | NextAuth + GitHub OAuth. httpOnly+Secure+SameSite session cookies. **AuthZ on every request: verify the row's `tenantId` == session tenant** (not just "logged in"). No passwords (OAuth only) → no password storage. |
| 5 | **SQL injection** | Prisma ORM only. **RLS** as DB-level backstop. Least-privilege DB role. No raw DB errors to client. |
| 6 | **CORS** | Explicit allowed origin = deployed domain. No `*`. `credentials: true`. |
| 7 | **HTTP headers** | Middleware: CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, remove X-Powered-By. |
| 8 | **File upload** | Mendel has **no user file uploads** — keep it that way (smallest attack surface). If ever added: MIME+ext+size validation, UUID rename, out-of-webroot/bucket. |
| 9 | **Error handling** | Generic errors to client; full detail + sanitized context to Sentry server-side. **Secrets scrubbed from logs/breadcrumbs.** 4xx vs 5xx correct. |
| 10 | **Dependency security** | `pnpm audit` clean gate on every install (already CLAUDE.md §5 r15). Pinned lockfile. Dependabot/Renovate *on Mendel's own repo* (we eat our own dogfood honestly). |
| 11 | **XSS** | No `dangerouslySetInnerHTML` (already CLAUDE.md §5 r9 — "Ever"). No `eval`/`new Function`. LLM + changelog output sanitized before render. |
| 12 | **Deploy checklist** | Pre-ship gate (§ below). |
| 🤖 | **AI/LLM** | Prompt-injection stripping on user input (already §5 r10). `max_tokens` set. LLM key server-side only. Per-tenant token budget + usage logging to detect abuse. |

### Multi-tenant additions (beyond the 12)
- **RLS + app-layer dual isolation** (F28) — the core data-loss/leak control. Tenant A's bug cannot read tenant B.
- **PAT/token blast-radius minimization** — BYO-compute (F32) keeps the clone-time PAT on the user's runner, not in the cloud, wherever possible.
- **Backups + PITR + tested restore runbook** (F30) — data-loss recovery is a control, not an afterthought.
- **Per-tenant compute/token budgets** (F34) — a cost-attack is a data-availability attack; cap it.
- **Account deletion = full tenant data cascade** — GDPR-shaped "right to delete"; verified by an isolation test that the deleted tenant's rows are gone and no other tenant is touched.

### Deploy checklist (pre-every-ship gate)
- [ ] No `.env` committed; all secrets in Vercel env
- [ ] RLS policies active on every tenant-owned table (verified by isolation test)
- [ ] Debug/verbose logging OFF in prod
- [ ] DB not publicly exposed; pooled connection only
- [ ] HTTPS enforced; security headers present (scan with securityheaders.com)
- [ ] Rate limiting active on every public endpoint
- [ ] CORS restricted to the deployed origin
- [ ] `pnpm audit` clean
- [ ] Sentry scrubbing confirmed (no token appears in a test error)
- [ ] Tenant-isolation test suite green

---

## 8. Data model evolution

- `Tenant` (new): `id`, `githubUserId`, `githubLogin`, `createdAt`.
- Every existing model: `tenantId String` → **NOT NULL**, FK → `Tenant`, RLS policy.
- `RunnerToken` (new, F32): tenant-scoped, hashed, revocable.
- `AuditLog` (extends `AgentLog`): tenant-scoped event trail.
- Migration discipline: **versioned `prisma migrate`** (not `db push`) from v3 onward — prod schema history must be auditable + reversible (data-loss prevention).

---

## 9. Testing & verification

Same discipline as v1.x/v2 (§7.1–§7.8, §11b, §11c), plus the **new mandatory class:**

- **Tenant-isolation tests (the v3 §11b-equivalent):** for every tenant-owned model + every API route + every MCP tool, a test proves tenant A's session cannot read/write/delete tenant B's row — at BOTH the app layer (Prisma scoping) and the DB layer (RLS, tested against real Postgres). A leak here is stop-the-line.
- **Auth flow E2E:** OAuth login → tenant creation → session cookie → logout.
- **Backup/restore drill:** documented + run once before launch (data-loss prevention is only real if restore is tested).
- **Hosted-sandbox §11b.1** (v3.2): real-container egress test on E2B/Fly, exactly like the per-language images got.
- Eval bench, smoke, visual-regression, `pnpm audit` — all still gate.

### Phase gates (half-day each)
- **v3.0:** isolation suite green (RLS + app, real Postgres) · `/inspect` live on deployed URL · deploy checklist green · auth E2E green.
- **v3.1:** local runner pulls + runs a tenant-scoped scan; cross-tenant queue access denied (tested).
- **v3.2:** hosted sandbox full scan + §11b.1 egress test on the provider.
- **v3.3:** external security checklist + Loom + case study + multi-tenant real-scan proof.

---

## 10. Cost model (free-tier-first)

| Component | v3.0–v3.1 | v3.2+ |
|---|---|---|
| Vercel Hobby | free | Pro when commercial |
| Neon/Supabase Postgres | free tier | paid at scale |
| GitHub OAuth | free | free |
| Upstash/KV rate-limit | free tier | paid at scale |
| Sentry | free tier | paid at scale |
| **Sandbox** | **free (local/BYO-compute)** | **paid (E2B/Fly) — the only real cost** |

**Bottom line:** v3.0 + v3.1 run at roughly $0 as a multi-tenant demo. The hosted sandbox (v3.2) is the single line item that costs money, and it's deferred until users + budget justify it. Per-tenant budgets cap it even then.

---

## 11. Spec amendments required (PROPOSED — awaiting sign-off)

To keep the source-of-truth docs consistent, v3 needs:
- **CLAUDE.md**: add **§5d — Multi-Tenant Security & Data-Loss Floor** (RLS+app dual isolation, secret blast-radius, backups, per-tenant budgets, account-deletion cascade); update §1 phase status (v3 ACTIVE); add a v3 column to the §2 stack table (Postgres/Neon, NextAuth, Vercel, Upstash, Sentry); extend §7 testing with the tenant-isolation class; add v3 forbidden patterns (no cross-tenant query, no `db push` in prod, no secret in logs).
- **TRD.md**: flesh §15 v3 into real specs (RLS policies, NextAuth wiring, `RemoteSandboxProvider` + runner protocol, hosted-sandbox provider, migration strategy).
- **PRD.md**: §12b v3 product scope — multi-tenant SaaS, BYO-compute, the free→paid story.
- **DESIGN.md**: add **§11c v3 screen briefs** (S0 login, S10 account/tenant, S11 runner status).

I will draft these as edits once you approve the plan — same "propose then apply" pattern v2 used.

---

## 12. Risks, kill criteria, open questions

**Top risks**
1. **Cross-tenant data/secret leak** — product-ending. Mitigation: dual isolation (RLS + app), exhaustive isolation tests as stop-the-line, secret scrubbing, blast-radius minimization via BYO-compute.
2. **Cloud can't reach local Docker** — architectural. Mitigation: BYO-compute runner model (F32); `/inspect`-live as the sandbox-free cloud surface.
3. **Cost-attack via scans/LLM** — availability + bill. Mitigation: per-tenant rate limits + token + sandbox-minute budgets.
4. **Migration data loss** — schema change drops data. Mitigation: versioned migrations, backups + tested restore, never `db push` in prod.

**Kill criteria**
- If isolation can't be proven green on real Postgres → do not deploy. No exceptions.
- If hosted-sandbox cost can't be capped per-tenant → keep v3.2 off; stay BYO-compute.

**Open questions — RESOLVED (owner, 2026-06-02)**
1. ~~Neon vs Supabase?~~ → **Supabase** (engine stays Postgres; Neon-swappable).
2. ~~`/inspect`-live public or gated?~~ → **Login-gated** (GitHub OAuth). One-click sign-in for devs; every use is a captured lead + per-tenant rate limits enforceable. F27 gates it; F31 + F34 enforce the per-tenant limit.
3. ~~Dogfood Dependabot or Mendel-scans-itself?~~ → **Mendel scans itself.** Its own repo is OWNED → PRs flow freely (§5c.1). Free real-world testing + the strongest story ("Mendel maintains Mendel"). No Dependabot on Mendel's repo (we don't outsource our own job to a competitor's bot).

**Remaining for owner (non-blocking):** verify Supabase free-tier idle-pause is acceptable for the always-available demo, or add a keep-alive (§9 backup/restore drill covers this check).

---

*Source-of-truth for v3. When something here conflicts with a one-off request, ask before deviating (CLAUDE.md §7.2a spec-deviation protocol).*
