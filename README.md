<div align="center">

<img src="docs/screenshots/01-landing.png" alt="Mendel — landing" width="100%" />

# Mendel

### An autonomous AI agent that maintains GitHub repositories — it finds stale dependencies with breaking changes, writes the migration patch, verifies it in a sandbox, and opens a Draft PR with cited evidence.

**Dependabot tells you a dependency is stale. Mendel ships the upgrade with the breaking-change patches already applied — scored by dual independent signals, and honest about what it didn't analyze.**

<br/>

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Next.js 15](https://img.shields.io/badge/Next.js-15_App_Router-000000?logo=next.js&logoColor=white)
![Docker](https://img.shields.io/badge/Sandbox-Docker_two--phase-2496ED?logo=docker&logoColor=white)
![Gemini](https://img.shields.io/badge/LLM-Gemini_2.x-8E75B2?logo=googlegemini&logoColor=white)
![Tests](https://img.shields.io/badge/tests-268_unit_%2B_45_e2e-C6FF3D)
![Status](https://img.shields.io/badge/status-local_demo-FFB84D)

</div>

---

## Table of Contents

- [Why Mendel](#why-mendel)
- [Screenshots](#screenshots)
- [How it works](#how-it-works)
- [The honesty contract](#the-honesty-contract)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Security model](#security-model)
- [Testing strategy](#testing-strategy)
- [Project journey](#project-journey)
- [Getting started](#getting-started)
- [Roadmap & issues](#roadmap--issues)
- [A note on scope](#a-note-on-scope)

---

## Why Mendel

Keeping a project's dependencies current is tedious and risky. Automated bots
(Dependabot, Renovate) are great at telling you *that* a version is behind — but
when the upgrade is a **major version with breaking changes**, they hand you a
red CI run and walk away. Someone still has to read the changelog, find the
broken call sites, write the migration, and prove it works.

**Mendel does that part.** Point it at a public repo and it will:

1. **Detect** stale dependencies whose latest version is a breaking major.
2. **Diagnose** the actual breaking changes — cited to the source changelog *and*
   verified against a real semantic API diff of the package's type declarations.
3. **Patch** your code (full-file or search/replace blocks), normalized with Prettier.
4. **Verify** the patch in an isolated two-phase Docker sandbox (install, then
   typecheck + tests + build with the network turned **off**).
5. **Submit** a Draft PR with a calibrated confidence score, per-signal breakdown,
   and an explicit "Not Analyzed" disclosure.

The differentiator isn't that it writes code — it's that it's **calibrated and
honest** about how confident it should be, and it never claims more than it
verified.

---

## Screenshots

> Dark-mode only. Cyberpunk + CRT aesthetic — pixel-art mascot ("Bones"),
> scan-line overlays, terminal chrome, tabular-num telemetry.

### Live Console — watch the agent reason in real time
The agent streams every phase over SSE: clone → detect → diagnose (with changelog
+ AST cross-referencing) → patch → two-phase sandbox verification. The mascot
reacts to the current phase; the dependency graph and confidence meter update live.

<img src="docs/screenshots/03-live-console.png" alt="Live agent console" width="100%" />

### Dashboard — scan history, calibration trends, PR-state sync
<img src="docs/screenshots/02-dashboard.png" alt="Dashboard" width="100%" />

### Settings — confidence threshold + sandbox network allowlist
Tune the score threshold that gates standard vs. Draft PRs, and manage the
tier-2 iptables egress allowlist the install sandbox is permitted to reach.
<img src="docs/screenshots/05-settings.png" alt="Settings" width="100%" />

### New Scan
<img src="docs/screenshots/04-new-scan.png" alt="New scan" width="100%" />

---

## How it works

```
            ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌─────────┐   ┌────────┐
  repo URL →│   SCAN   │ → │  DIAGNOSE │ → │  PATCH   │ → │ VERIFY  │ → │ SUBMIT │ → Draft PR
            └──────────┘   └───────────┘   └──────────┘   └─────────┘   └────────┘
                 │              │               │              │             │
          package.json +   changelog signal  full-file /   two-phase     calibrated
          npm registry     x semantic-diff   search-replace  Docker:      confidence
          (stale majors)   signal → score    + Prettier      A: install   score + gate
                                                              (bridge,     (standard /
                                                              iptables)    draft / skip)
                                                              B: test
                                                              (network=none)
```

**Dual-signal detection.** Two independent analyses run in parallel and are
scored against each other:

- **Changelog signal** — parses the package's published changelog for documented
  breaking changes, with the source URL cited in the PR.
- **Semantic-diff signal** — a 3-tier API differ between the old and new versions:
  - **Tier 1** — TypeScript compiler API over shipped `.d.ts` declarations.
  - **Tier 2** — for JS+JSDoc packages with no `.d.ts`, declarations are
    synthesized via the TypeScript compiler, then walked like Tier 1.
  - **Tier 3** — AST-level diff of raw JS source as a last resort.

When the two signals **disagree**, that's surfaced as *lower* confidence — never
papered over.

---

## The honesty contract

Mendel's ethical floor is honest framing of what the agent actually knows. This
is enforced in code, not just intention:

- **Calibrated, asymmetric scoring.** A breaking change confirmed by both signals
  scores high; a single weak signal scores low. Verification failure **caps** the
  overall score regardless of detection confidence.
- **Threshold gating.** `score ≥ threshold` → standard PR · `40 ≤ score < threshold`
  → **Draft** PR with a low-confidence warning · `score < 40` → **no PR**, diagnosis
  surfaced for manual review.
- **Coverage is reported.** "Analyzed X of Y exported symbols (Z%)."
- **Every PR carries a "Not Analyzed" section** — transitive deps, runtime
  behavior, test coverage of changed paths.
- **No breaking change is asserted without its source citation.**

---

## Architecture

```
mendel/
├── app/                      # Next.js 15 App Router (marketing + authed app)
│   ├── (app)/scan/[id]/       # Live Console — absorbs issue/PR detail inline + permalinks
│   ├── (app)/dashboard/       # scan history, calibration trends, PR-state sync
│   └── api/                   # scans, rejections, poll-prs, pat-validation (Zod + rate-limited)
├── lib/
│   ├── agent/
│   │   ├── phases/            # scan · diagnose · patch · verify · submit
│   │   ├── signals/           # changelog.ts · semantic-diff.ts (3-tier)
│   │   ├── confidence/        # asymmetric scoring · threshold gate · calibration summary
│   │   ├── patching/          # full-file + search/replace strategies
│   │   └── learning/          # rejection-learning loop (PR-state polling + embeddings)
│   ├── sandbox/               # Docker executor · iptables allowlist · node_modules cache (LRU)
│   ├── github/                # octokit wrapper (clone, PR, dedup, fork)
│   ├── llm/                   # provider-agnostic Gemini client (retry + Zod validation)
│   └── db/                    # Prisma + SQLite
├── components/                # mascot · console · 3D dep graph · confidence meters
├── docker/                    # sandbox image + iptables entrypoint
└── tests/                     # vitest unit/integration + Playwright E2E
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript strict) |
| Styling | Tailwind v4 + custom design tokens |
| Animation | Framer Motion + GSAP |
| 3D | Three.js / React Three Fiber (dependency graph) |
| State | Zustand |
| Database | SQLite + Prisma |
| Validation | Zod (every API boundary + every LLM output) |
| LLM | Google Gemini (provider-agnostic wrapper) |
| GitHub | Octokit |
| Sandbox | Docker (Node + pnpm), `--network=bridge` → `--network=none`, iptables allowlist |
| Semantic diff | TypeScript compiler API |
| Tests | Vitest + Playwright |
| Logging | Pino |

---

## Security model

Security was a first-class constraint, not an afterthought:

- **Two-phase sandbox.** Phase A (install) runs `--network=bridge` behind a
  **default-deny iptables egress filter** (only an allowlist of registries/CDNs is
  reachable); Phase B (test) runs fully `--network=none`. Both non-root, memory-capped,
  time-bounded, and torn down after each run.
- **Secrets never leave the server.** GitHub PATs are encrypted at rest
  (AES-256-GCM); the LLM key is server-side only; nothing sensitive is logged or
  returned to the client.
- **Every input is validated** with Zod server-side; every route is rate-limited.
- **LLM outputs are schema-validated** (Zod) with bounded retries and a hard token cap per scan.
- **Prompt-injection patterns are stripped** from user input; no `eval`, no unsafe raw-HTML injection.
- File operations are sandboxed to `./workspace` and `./logs` with path-escape rejection.

---

## Testing strategy

This is a project explicitly built to defend against the failure mode of
plausible-looking-but-broken AI-generated code:

- **268 unit/integration tests** + **45 Playwright E2E tests**, plus gated
  integration suites that run against **real Docker** (sandbox egress filter,
  cache eviction) and **real npm** (semantic diff).
- Pure logic (confidence math, cache keying, allowlist validation, diff planning)
  is exhaustively unit-tested and deterministic.
- Docker orchestration is verified against **real containers** — e.g. a test
  proves the iptables allowlist genuinely blocks a non-allowlisted host (`curl` →
  no response) while permitting an allowlisted one.
- Visual-regression snapshots guard all primary screens.

```bash
pnpm typecheck && pnpm lint && pnpm test    # gate before every commit
pnpm smoke                                  # Playwright E2E
pnpm test:docker                            # real-container sandbox tests (needs Docker)
```

---

## Project journey

Mendel was built in deliberate phases — a useful lens on how I scope and ship:

| Phase | Focus |
|---|---|
| **v1.0** — Working Demo | End-to-end agent: changelog detection, full-file patching, two-phase Docker sandbox, real Draft PRs on a live repo. |
| **Phase D** — Design Iteration | Rebuilt the visual layer to an Awwwards-tier cyberpunk-CRT brief; 2D mascot ("Bones") with per-phase reactions; hybrid screen architecture. |
| **v1.5** — Calibrated Confidence | Semantic API diffing, asymmetric dual-signal scoring, search/replace patching, iptables allowlist, `node_modules` LRU cache, rejection-learning loop, threshold-gated submission. |

Each phase had explicit "definition of done" gates and a spec-conformance audit
before anything was called finished.

---

## Getting started

> Mendel runs **locally only** (it is not a deployed service). You need Node 20+,
> pnpm 9+, Docker Desktop, and a Google Gemini API key.

```bash
pnpm install
cp .env.example .env          # fill GEMINI_API_KEY + ENCRYPTION_KEY (>= 32 chars)
pnpm db:push                  # set up the SQLite schema
docker compose build          # build the sandbox image (one-time)
pnpm dev                      # http://localhost:3000
```

Connect a GitHub Personal Access Token in **Settings**, paste a public repo URL
in **New Scan**, and watch the Live Console.

---

## Roadmap & issues

Active work, known limitations, and future features are tracked in
[**Issues**](../../issues) and grouped with labels:

- `enhancement` / `feature` — planned capabilities (monorepo support, more
  language ecosystems, cloud deployment).
- `bug` — known issues.
- `roadmap` — larger directional bets.
- `good first issue` — scoped entry points.

---

## A note on scope

Mendel is a portfolio / demonstration project built to explore **autonomous,
verifiable, honestly-calibrated AI agents** — not a production SaaS. It runs on a
single machine, targets public single-package repositories, and opens every PR as
a **Draft** for human review. The interesting engineering is in the verification
and confidence-calibration layers, and in refusing to let the agent overclaim.

<div align="center">
<br/>
<sub>Built with TypeScript, a lot of tests, and a strong opinion that AI tools should be honest about what they don't know.</sub>
</div>
