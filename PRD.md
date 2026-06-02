# PRD — Mendel

# PRD — Mendel: Autonomous OSS Maintenance Agent

> Product Requirements Document | **Revision 4** | Last updated 2026-05-20
> 

---

## 0. Revisions Log

**Rev 5 (2026-05-28)** — v2 roadmap expansion (local-first; cloud deferred to v3). Companion doc [V2_PLAN.md](http://v2_plan.md/) authored as the phased blueprint; this revision folds its durable specs into the PRD. Major changes:

- **§12 expanded** from 9 roadmap bullets into 8 numbered features **F19–F26** with release sequencing (v2.0 → v2.4). New **§12b** carves out the cloud rearchitecture (multi-tenant, hosted sandbox, OAuth) as **v3**.
- **v2 stays local** — Docker sandbox, PAT-session, SQLite retained; capability depth (eval bench, smoke-test, monorepo, multi-language, auto-merge, continuous monitoring, MCP) is the v2 focus. Cloud is v3.
- **§7 Non-Goals updated** — monorepo, multi-language, auto-merge, and continuous monitoring move from "non-goal" to **in-scope for v2**.
- **§8 Success Metrics** gains a **v2 column** (calibration accuracy from the eval bench, polyglot PR acceptance, auto-merge precision).
- **§17 Capability Honesty** gains a v2 paragraph — **language-aware confidence ceilings** + the **honesty-of-action floor** gating auto-merge (new CLAUDE.md §5c).
- Sequencing principle: **measure before expand** — v2.0 ships the eval harness + smoke-test layer first, so every later capability is validated against a fixture bench with calibration numbers.

**Rev 4 (2026-05-20)** — post-v1.0-ship review + design iteration insertion. Major changes:

- v1.0 ships functionally (agent works, real Draft PRs landed on `megadave19/mendel-test` for axios + typescript upgrades). UI shipped but does not earn the cyberpunk-CRT positioning — "AI-slop" execution.
- Three v1.0 screens never built: S5 Issues List, S6 Fix Detail, S7 PR Confirmation. The screens where calibrated-confidence positioning lives. v1.0 functionally complete; product-completeness incomplete.
- **Phase D (Design Iteration)** inserted between v1.0 and v1.5. Produces [DESIGN.md](http://design.md/), redesigns shipped screens, builds the missing S5/S6/S7 as inline states + permalink routes.
- Screen architecture revised: S5/S6/S7 fold into S4 (Live Console) as inline states. Permalink routes (`/scan/[id]`, `/scan/[id]/issue/[id]`, `/scan/[id]/pr/[id]`) reuse the same components for shareable URLs.
- v1.5 scope unchanged but now starts after Phase D ships.

**Rev 3 (2026-05-18)** — second CTO-review pass + capability honesty pass. Major revisions:

- **Split v1 into v1.0 (Working Demo) and v1.5 (Calibrated Confidence)** — phased delivery, not scope reduction. Every CTO-feedback point lands somewhere; v1.0 ships faster with explicit limitations, v1.5 adds the depth.
- Tagged every feature [v1.0] or [v1.5] for clarity
- Added **Capability Honesty** section (§17) — transparent about what's deferred to v1.5 specifically because complexity-vs-vibe-coding-with-non-coder tradeoffs make it safer to phase
- v1.0 confidence model simplified: single-signal (changelog), all results labeled "medium — needs review"
- v1.5 brings the refined asymmetric confidence math (changelog-silent + AST-detected = 65–75, not 20)
- v1.5 brings two-tier network allowlist with per-scan opt-in for repos needing binary fetches (Puppeteer, Prisma, etc.)
- Realistic timelines: v1.0 in 4 weekends, v1.5 in +3–4 weekends

**Rev 2 (2026-05-18)** — first CTO-review pass; added confidence system, two-phase sandbox, semantic diffing, Prettier-based style, monorepo rejection.

**Rev 1 (2026-05-18)** — initial draft.

---

## 1. Executive Summary

Mendel is an autonomous AI agent that performs ongoing maintenance work on public GitHub repositories. It scans for stale dependencies with breaking changes, generates code fixes with cited evidence, runs verification in an isolated sandbox, and opens pull requests with explicit confidence scoring and "Not Analyzed" disclosures.

Built as an AI PM portfolio project demonstrating pro-level agent architecture, API engineering, and calibrated uncertainty design. Delivered in two phases:

- **v1.0 (Working Demo)** — 4 weekends. Single-signal detection (changelog parsing), full-file patch generation, isolated Docker sandbox, full UI polish, 3 real PRs on curated OSS repos. **A complete portfolio piece on its own.**
- **v1.5 (Calibrated Confidence)** — +3–4 weekends after v1.0 ships. Adds semantic API diffing, refined confidence calibration, search-replace block patching, rejection-learning loop, broader repo support. The "what's next" half of your interview narrative.

Both phases run locally with $0 infrastructure cost using Claude Pro + free tiers.

## 2. Problem

Every engineering team carries a backlog of mechanical maintenance work: dependency upgrades that introduce breaking changes (Dependabot bumps versions; humans fix the breakage manually), recently-added code without test coverage, documentation drift. Universal, tedious, critical, chronically deprioritized. Senior developers cost $200+/hr and complete ~5% of their maintenance backlog per quarter. The work needs a different economic actor.

## 3. Central Design Risk — Calibrated Confidence Is the Ethical Floor

**Failure mode to avoid:** Mendel ships a PR claiming to fix breaking changes, misses one, user merges with false confidence, production breaks. Mendel becomes worse than Dependabot — Dependabot is dumb but predictably dumb; users know they need to test. A "smart" agent that misses things one out of ten times destroys trust permanently.

**v1.0 mitigation** (single-signal): every PR is explicitly labeled "medium confidence — manual review required." No high-confidence claims, no auto-merge, full "Not Analyzed" disclosure. The agent is positioned as a *fast first draft of the fix*, not the final answer.

**v1.5 mitigation** (dual-signal): refined calibration with asymmetric scoring. AST/semantic-diff catches what changelog misses (the common case) → medium-high confidence. Changelog claims what AST can't confirm → low confidence (changelog might be wrong). Both signals agree → high confidence.

Trust model is the same in both phases: *"the agent shows you exactly what it knows and doesn't know."*

## 4. Existing Solutions and Their Gaps

| Product | Does | Gap |
| --- | --- | --- |
| Dependabot | Auto-PRs dep version bumps | No breaking-change fixes |
| Renovate Bot | Configurable dep updates | Same gap |
| Snyk | Security vuln scanning | Notifies only |
| GitHub Copilot Workspace | AI coding for assigned tasks | Not autonomous |
| Copilot Autofix | Fixes security alerts | Narrow scope |
| Devin | General autonomous engineer | Closed, $500/mo |
| CodeRabbit, Greptile | PR review | Doesn't open PRs |

**Mendel's gap:** open-source, autonomous maintenance agent specialized for OSS, with honest scoping in v1.0 and dual-signal calibration in v1.5.

## 5. Positioning

> **v1.0:** *"Dependabot version-bumps; Mendel ships a working migration patch as a starting point — explicit about needing your review."*
> 

> **v1.5:** *"Dependabot tells you a dep is stale; Mendel ships the upgrade with breaking-change patches already applied, tested, scored for confidence via dual independent signals, and honest about what it didn't analyze."*
> 

> **Always:** *"Mendel isn't smarter than your developers. It's tireless, consistent, and honest about its uncertainty."*
> 

## 6. Target Users

**Primary user:** OSS maintainers and engineering managers wanting tech debt worked down with calibrated risk.

**Demo user (portfolio context):** AI PM hiring managers grading on technical depth (API + agent design), product judgment (phased scoping, confidence calibration), and demo quality (visual polish, real PRs).

## 7. Goals & Non-Goals

### v1.0 Goals

- Working autonomous agent loop on real public GitHub repos
- 3 real merged PRs as portfolio proof
- UI demonstrating the agent's reasoning in real time
- Explicit "medium confidence — manual review" framing on every PR
- $0 cost, runs locally

### v1.5 Goals (added on top of v1.0)

- Dual-signal detection with refined confidence calibration
- Rejection-learning loop
- Broader repo support (extended network allowlist, larger refactor scope via search-replace blocks)

### Non-Goals (v1.0 / v1.5)

- Multi-language support (TypeScript/JavaScript only) — **→ in scope for v2 (F23: Python, Go, Rust)**
- Auto-merge — every PR requires human review — **→ in scope for v2 (F24, opt-in + narrow envelope per CLAUDE.md §5c honesty-of-action floor)**
- Continuous monitoring across repos — **→ in scope for v2 (F25, local cron worker)**
- **Monorepos** (workspaces explicitly out of scope through v1.5) — **→ in scope for v2 (F21)**

### Non-Goals (still deferred to v3 / out of scope entirely)

- Enterprise auth, multi-tenancy, billing — **v3 (cloud)**
- Cloud deployment, hosted sandbox, OAuth — **v3 (cloud); see §12b**
- General-purpose autonomous coding — **out of scope entirely**

## 8. Success Metrics

| Metric | v1.0 target | v1.5 target | v2 target |
| --- | --- | --- | --- |
| PR acceptance rate on real public repos | ≥ 25% (medium-confidence framing) | ≥ 40% | ≥ 40% maintained across **polyglot** repos (TS/Py/Go/Rust) |
| Bug regression rate (merged PRs causing new bugs in 30 days) | < 10% | **< 5%** | < 5% maintained; measured continuously via the eval bench (F19) |
| Mean time scan-start → PR opened | < 20 min | < 15 min | < 15 min (per package in a monorepo) |
| Confidence calibration accuracy (high-conf PRs that are correct) | N/A (no high-conf in v1.0) | ≥ 90% | ≥ 90%, **proven by the committed eval-bench baseline**; no calibration regression release-over-release |
| Auto-merge precision (auto-merged PRs that are correct) | N/A | N/A | ≥ 98% (F24 — narrow envelope, opt-in) |
| Demo quality (UI polish, animations) | Awwwards-tier | Maintained | Maintained (one new "watching" mascot pose; reuse otherwise) |
| Public OSS PRs merged during demo phase | ≥ 3 | ≥ 6 total | ≥ 9 total (≥ 3 more on harder/polyglot repos) |
| Loom demo length | < 3 min | < 4 min (covers calibration story) | < 5 min (polyglot + monorepo + auto-merge + monitor + MCP) |

## 9. User Flows

### Flow A — First-time scan (v1.0)

1. Lands on Mendel home (animated landing with mascot)
2. "Connect GitHub" → PAT entry modal
3. PAT validated → repo picker
4. Pastes public repo URL → "Scan this repo"
5. Live Console renders; agent narrates via SSE
6. Issues populate; **all tagged "medium confidence — review required"**
7. User clicks "Generate Fix" on a chosen issue
8. Agent generates patch, runs verification, shows results
9. User reviews diff + "Not Analyzed" disclosure
10. User clicks "Open Draft PR" (v1.0 opens Drafts only)
11. Real PR appears on GitHub
12. Dashboard updates

### Flow A — Scan flow (v1.5 deltas)

- Issues tagged with calibrated confidence scores (high / medium / low)
- High-confidence issues can be auto-PR'd (not Draft) if user threshold permits
- Low-confidence: no auto-PR, surface diagnosis only

### Flow B — Return user

1. Dashboard with confidence-trend chart (v1.5; v1.0 dashboard shows simpler stats)
2. Past scans, PRs opened/merged, regression rate
3. Re-scan or scan new repo

## 10. Features — v1.0 (Working Demo)

### F1: GitHub Connection [v1.0]

PAT entry, scopes `repo` + `read:user`; AES-256-GCM encryption at rest; validated on entry.

### F2: Repo Scanner [v1.0]

- Accepts public GitHub repo URL; clones into `./workspace/<repo>`
- **Rejects monorepos** (detects workspace markers)
- Rejects non-TS/JS, > 500MB, repos without `tsconfig.json` (v1.0 is TS-typed only)
- Parses `package.json`, lockfile, test config

### F3: Detection — Stale Deps [v1.0]

**Single signal (changelog parsing):**

- Scans `package.json` for outdated deps via npm registry
- Fetches changelog (GH releases → fallback [CHANGELOG.md](http://CHANGELOG.md))
- LLM extracts breaking changes with Zod-validated structured output
- AST analysis finds usage sites in repo

### F4: Diagnosis Engine [v1.0]

For every detected issue:

- What / Why it matters / Evidence / Proposed fix
- **Confidence: always "medium — manual review required"** (single-signal limitation)
- "Not Analyzed" list: explicit on what wasn't or couldn't be checked

### F5: Patch Generation [v1.0]

- **Full-file regeneration** with style hints
- **Max 3 files per issue** (token budget)
- Local diff computation
- Style normalization via Prettier (in sandbox using repo's config)

### F6: Sandbox Verification — Two-Phase [v1.0, simplified]

- **Phase A (install)**: Docker container with `--network=bridge` (full default network), runs `pnpm install` (or detected pm), 3-min timeout, snapshots `node_modules`
- **Phase B (test)**: Docker container with `--network=none` (zero egress), uses Phase A snapshot, runs `tsc --noEmit`, `eslint`, test suite, `pnpm run build` if defined. 5-min timeout.
- Both containers non-root, 2GB memory cap, ephemeral
- v1.5 will add iptables-level allowlist on Phase A

### F7: PR Generation [v1.0]

- Forks target repo if needed
- Branch: `mendel/<type>/<slug>-<unix-ts>-<4char-nonce>`
- **Pre-flight deduplication check** (queries open PRs)
- **Opens as Draft PR in v1.0** (forces human review)
- PR description includes diagnosis, confidence ("medium — review required"), verification results, "Not Analyzed" disclosure

### F8: Live Agent Console (UI) [v1.0]

Three-pane: mascot+state (left), streaming reasoning (center), 3D dependency graph (right). SSE-driven, line-by-line typing, syntax highlighting, status pills (SCANNING / DIAGNOSING / PATCHING / VERIFYING / DONE).

### F9: Dashboard [v1.0]

Hero stats: PRs opened, PRs merged, time saved. Recent scans table. Per-repo summary cards. (Confidence trend chart added in v1.5.)

### F10: Settings [v1.0]

GitHub PAT, Gemini API key, UI toggles (mascot, sound, reduce-motion).

### F11: Single-Signal Confidence Framing [v1.0]

- Every issue and PR labeled "medium confidence — manual review required"
- No high-confidence claims
- "Not Analyzed" disclosure on every PR explicitly lists analysis limits
- All PRs open as Drafts; user marks ready for review

## 11. Features — v1.5 (Calibrated Confidence)

### F12: Signal B — Semantic API Diffing [v1.5]

- Downloads tarballs of `dep@old` and `dep@new`
- TypeScript compiler API extracts exported type surfaces from `.d.ts`
- Computes deterministic diff: removed exports, signature changes, type widening/narrowing
- Falls back to `api-extractor` if `.d.ts` absent
- Cross-references repo AST usage
- Outputs structured `ApiDiff` with coverage percentage and unanalyzable-symbol list

### F13: Calibrated Confidence Scoring Engine [v1.5]

Asymmetric scoring:

| Scenario | Score | Bucket | Tag |
| --- | --- | --- | --- |
| Both signals agree | 85–95 | high | — |
| AST/semantic catches it, changelog silent | **65–75** | medium-high | "undocumented breaking change" |
| Changelog claims, AST doesn't confirm, good coverage | 40–55 | low-medium | "needs manual verification" |
| Changelog claims, AST silent (JS-only / poor coverage) | 55–65 | medium | "incomplete analysis" |
| Only changelog available (semantic diff not runnable) | 55–65 | medium | "single-signal" |
| Heuristic match only | 30–45 | low | — |

Per-patch adjustments: -15 if uncovered lines touched, -10 if behavioral changes, +10 if < 5 lines.

Verification result gates the bucket (failure caps at "low").

User-configurable threshold for auto-PR vs. Draft.

### F14: Search-Replace Block Patching [v1.5]

- Files < 150 lines: full-file regeneration (current v1.0 approach)
- Files 150–500: search-replace blocks (Aider-style)
- Files > 500: hard-required search-replace blocks
- Robust block matching with fuzzy fallback + retry
- Drops the "max 3 files per issue" cap → cap by total tokens (100k); agent prioritizes by impact

### F15: Two-Tier Network Allowlist [v1.5]

- **Tier 1 (default, strict):** `registry.npmjs.org`, `github.com`:443 (iptables-enforced inside Phase A container)
- **Tier 2 (opt-in per scan):** adds `storage.googleapis.com` (Puppeteer), `*.azureedge.net` (Playwright), `binaries.prisma.sh`, `objects.githubusercontent.com` (GitHub Release binaries)
- UI surfaces tradeoff: *"This repo's deps fetch binaries from external sources. Allow this network access for this scan?"*

### F16: Rejection-Learning Loop [v1.5]

- When PR is closed without merge, scrape reason from comments (or prompt user)
- Store in `RejectionPattern` table with embedding
- Future diagnoses on similar dep/change-type retrieve relevant rejection patterns as negative-example context

### F17: Extended Repo Support [v1.5]

- JS-only packages (no `tsconfig.json`) with AST-only analysis + explicit lower confidence
- npm + yarn package managers (in addition to pnpm)
- Jest support (in addition to Vitest)

### F18: node_modules Caching [v1.5]

- Cache key: `pnpm-lock.yaml` hash + Node version + OS
- Skip Phase A install if cache hit; massively faster repeated scans

## 12. Features — v2 (Local-first; cloud is v3)

v2 deepens the engine **on the local machine** — no cloud rearchitecture (that's §12b / v3). Full phased build plan, UI/UX, infra, and verification detail live in **[V2_PLAN.md](http://v2_plan.md/)**; this section is the canonical feature definition + release mapping.

**Sequencing principle (CTO call): measure before expand.** v2.0 ships the measurement layer (eval bench + smoke-test) first, so every later capability is validated against a fixture bench with calibration numbers. Auto-merge cannot ship responsibly without it.

| # | Feature | Release | Notes |
| --- | --- | --- | --- |
| **F19** | **Eval Harness + Fixture Bench** | v2.0 | Repeatable bench scoring breaking-change precision/recall + confidence-calibration accuracy. The instrument behind §8's v2 metrics. CLI (`pnpm eval`) + optional read-only `/dev/eval`. |
| **F20** | **Smoke-Test Execution (Sandbox Phase C)** | v2.0 | After patch, boot the app in the sandbox (`--network=none`) and confirm it comes up. Raises the verification ceiling above "tests pass." Hard prerequisite for F24. |
| **F21** | **Monorepo / Workspace Support** | v2.1 | Detect workspace root, enumerate member packages, scan per-package, group results under one scan. Lifts the v1.x monorepo rejection. |
| **F22** | **"Point at any API" Mode** | v2.1 | Point Mendel at a package + version range (no repo, no PR) → breaking-change report. Reuses the signal + scoring pipeline; confidence structurally capped (no verification). New `/inspect` route. |
| **F23** | **Multi-Language Support** | v2.2 | Language-adapter layer, then **Python → Go → Rust**, each shelling to real ecosystem API-diff tools (griffe / apidiff / cargo-semver-checks) inside per-language sandbox images. Confidence ceilings are language-aware (§17). Sub-phased + benched per language. |
| **F24** | **Auto-Merge for High-Confidence Categories** | v2.3 | The first time Mendel *acts* instead of *suggests*. Opt-in per repo, default OFF, narrow envelope (patch/minor bumps, no breaking change by **both** signals, tests + smoke pass, confidence ≥ high floor). Governed by the honesty-of-action floor (CLAUDE.md §5c). |
| **F25** | **Continuous Monitoring** | v2.3 | A local watchlist scanned on schedule by a separate `pnpm monitor` worker (node-cron). Turns Mendel into an autonomous local service. Honest about local-uptime limits. New `/watchlist` route + one new "watching" mascot pose. |
| **F26** | **MCP Server** | v2.3 | Expose Mendel as a callable agent (`mendel_scan_repo`, `mendel_inspect_api`, …) via `@modelcontextprotocol/sdk` (stdio). Wraps the same gated lib functions — callers can't bypass confidence/draft/auto-merge rules. |

**v2.4 — Ship & Prove:** updated Loom, case study v2 (eval-bench numbers are the headline), published bench baseline + per-release deltas, ≥ 3 more real PRs on harder/polyglot repos.

## 12b. Features — v3 (Cloud)

**PLANNED. Full build blueprint: [V3_PLAN.md](http://v3_plan.md/). Binding security rules: CLAUDE.md §5d.** Deferred from v2 because they couple Mendel to hosted infrastructure (external accounts + cost). v2 built **cloud-ready** so v3 is a deployment + multi-tenancy project, not a rewrite (nullable `tenantId`, a `SandboxProvider` interface, pure policy layers, out-of-process workers, no SQLite-specific queries).

**Product one-liner (v3):** *"Mendel, but as a hosted SaaS — sign in with GitHub, get a thorough, honestly-calibrated dependency analysis on your repos, and never see another user's data or token."*

**Strategy — free-tier-first, no rewrite.** The cloud **control plane** (UI, multi-tenant DB, GitHub login, live `/inspect`, dashboards) runs at ~$0 on free tiers. The only real cost is the **hosted sandbox** (running untrusted OSS code), which is deferred — compute stays on **local Docker via a BYO-compute runner** until users + budget justify the spend.

| # | Feature | What it is |
|---|---|---|
| F27 | GitHub OAuth login | NextAuth + GitHub, replacing PAT-session; httpOnly session cookies; explicit scope disclosure |
| F28 | Multi-tenant data + RLS | Every row tenant-owned; **dual isolation** (Postgres Row-Level Security + Prisma app-layer scoping) so no user can ever see another's data |
| F29 | Cloud deploy + headers | Vercel; CSP/HSTS/X-Frame/CORS hardening |
| F30 | Hosted Postgres + DLP | **Supabase Postgres** + connection pooling + automated backups/PITR + tested restore runbook |
| F31 | `/inspect` live | F22's pure-analysis surface runs in the cloud — **no sandbox, free** — **login-gated** demo (one-click GitHub sign-in → every use is a captured lead), per-tenant rate-limited |
| F32 | Local-runner bridge | `RemoteSandboxProvider`: cloud queues a scan, the user's `pnpm runner` executes it in their **local Docker** and pushes results back — full scans, free, PAT stays on the user's machine |
| F33 | Hosted sandbox (opt-in, paid) | E2B/Fly behind the v2 `SandboxProvider`, with §11b.1 egress test + per-tenant sandbox-minute budget |
| F34 | Observability + abuse protection | Sentry (secret-scrubbed) · per-tenant rate limits + LLM/sandbox budgets · tenant-scoped audit log |
| F35 | Ship & prove | Security audit · Loom (cloud) · case study · multi-tenant real-scan proof |

**Release sequencing:** v3.0 control plane (F27–F31, F34 core — free) → v3.1 BYO-compute scans (F32 — free) → v3.2 hosted sandbox (F33 — paid, opt-in) → v3.3 ship & prove (F35).

**Resolved product decisions (2026-06):** cloud `/inspect` is **login-gated** (GitHub OAuth — one-click for devs; every use becomes a captured lead, and per-tenant rate limits become enforceable); dependency freshness on Mendel's own repo is handled by **Mendel scanning itself** (dogfood), not Dependabot.

**Out of scope for v3 (honest boundaries):** no user file uploads (smallest attack surface); no roll-your-own auth; no cross-tenant features.

## 13. UX / UI Design Language

(Unchanged across phases — design is shipped in v1.0 in full.)

### Aesthetic

Cyberpunk + oldschool CRT. Pixel-art mascot, scan-line overlays, terminal aesthetics elevated. Reference: Akash Malhotra's 3D portfolio. Awwwards-tier. Dark mode only.

### Color System

```css
--bg-0: #0A0A0A;
--bg-1: #111111;
--bg-2: #1A1A1A;
--accent-primary: #C6FF3D;   /* lime — high conf, success */
--accent-secondary: #3DFFEE; /* cyan — links */
--accent-warning: #FFB84D;   /* amber — medium conf, warnings */
--accent-danger: #FF4D5E;    /* red — low conf, errors */
--text-primary: #F5F5F5;
--text-secondary: #9A9A9A;
--text-muted: #555555;
--glow-primary: 0 0 24px rgba(198, 255, 61, 0.4);
```

### Typography

- Headings: JetBrains Mono (700)
- Body: Geist Sans (400/500)
- Code: JetBrains Mono (400)
- `font-variant-numeric: tabular-nums` on numerics

### Motion Principles

Every state animated; spring easing (stiffness 280, damping 28); GSAP timelines for page transitions; hover scale 1.02 + glow; respect `prefers-reduced-motion`.

### Confidence Visualization

- **v1.0**: All confidence badges show amber "medium — needs review" — visual reinforcement of the v1.0 framing
- **v1.5**: Color-coded confidence meters (lime/amber/red), signal-source pills, "Not Analyzed" callout with amber border (always visible, never hidden)

### Mascot Animation States

| State | Animation | Phase |
| --- | --- | --- |
| Idle | Floating bob, visor pulse | v1.0 |
| Scanning | Slow rotation, magnifying glass | v1.0 |
| Thinking | Visor flickers cyan, gears visible | v1.0 |
| Detecting | Visor flashes amber, head tilt | v1.0 |
| Patching | Wrench, sparks | v1.0 |
| Verifying | Tablet, check marks | v1.0 |
| Uncertain | Visor flickers cyan/amber, hand scratches "head" | v1.5 |
| Success | Celebration jig, visor lime burst | v1.0 |
| Failure | Head shake, visor red | v1.0 |
| Error | Static/glitch overlay | v1.0 |

## 14. Screens (revised in Rev 4 — hybrid architecture)

The screen list collapses from 9 to 6 routes. S5, S6, S7 become inline states within S4 + permalink routes that reuse the same components. See [DESIGN.md](http://design.md/) §10 for the full architecture rationale.

**Routes:**

- `/` — **S1 Landing / Boot sequence**
- `/scan/new` — **S3 New Scan** (S2 PAT modal overlays here)
- `/scan/[id]` — **S4 Live Console** (absorbs S5 streaming + S6 expansion + S7 confirmation inline)
- `/scan/[id]/issue/[id]` — **S6 permalink** (static fix detail for case study links)
- `/scan/[id]/pr/[id]` — **S7 permalink** (PR confirmation, post-hoc)
- `/dashboard` — **S8 Dashboard**
- `/settings` — **S9 Settings**

Full per-screen briefs live in [DESIGN.md](https://www.notion.so/Design-md-Mendel-366a2e9f37e28064adb1ddc03bfcbedd?pvs=21) §11.

## 15. Edge Cases

| Case | Behavior |
| --- | --- |
| Repo > 500MB | Reject with friendly message |
| Monorepo detected | Reject: *"Monorepo detected. v1 supports single-package only; multi-package on the v2 roadmap."* |
| Non-TS-typed repo (no tsconfig.json) | **v1.0:** Reject. **v1.5:** Accept with explicit lower-confidence framing |
| Gemini rate limit | Queue + backoff; user notified |
| GitHub rate limit | Same |
| **Phase A install fails (e.g., postinstall hits non-allowlisted host)** | **v1.0:** Surface install logs with explanation; don't proceed; suggest trying a different repo. **v1.5:** Offer to retry with extended network allowlist |
| Tests fail after patch | No PR; show failure logs |
| Signals disagree | **v1.0:** N/A (single signal). **v1.5:** Confidence drops per asymmetric scoring; surface diagnosis only if low |
| Existing open PR for same dep | Surface existing PR URL; offer "Force new PR" override |
| LLM outputs invalid JSON | Retry up to 3 times with format-error feedback |
| Concurrent scans on same repo | UI prevents (scan button disabled while scan running) |

## 16. Open Questions

- **v1.0 Draft-PR default**: ship every PR as Draft, requiring user to mark "Ready for Review"? *(Lean yes — reinforces medium-confidence framing)*
- v1.5 confidence threshold default: permissive (more auto-PRs) or conservative (more drafts)? *(Lean conservative)*
- Mascot personality: subtle dry humor on success states only, neutral on uncertainty/error
- v2 private repos: GitHub App vs OAuth? *(TBD)*

## 17. Capability Honesty *(new in Rev 3)*

This is a vibe-coding project. PM (you) + Claude (me). No human dev pair. Some things are within my reliable capability; some need to be phased to v1.5 because the failure mode for non-coder + Claude is "stuck for a weekend on a Docker networking issue" — that's the kind of debug spiral that kills portfolio projects.

**Deferred to v1.5 specifically because of vibe-coding-with-non-coder risk:**

- Iptables-level network allowlist inside Docker (cross-platform Docker networking is genuinely finicky)
- TypeScript compiler API for semantic diffing (edge cases in re-exports, conditional types, declaration merging)
- Search-replace block patching with fuzzy matching + retry (LLM whitespace mismatches happen 10–15% of the time and need handling)
- `api-extractor` integration for JS packages
- `node_modules` layered caching (cache invalidation edge cases)

**Solidly in scope for v1.0:**

- Full Next.js + Tailwind + Framer Motion + Three.js UI
- GitHub API operations via octokit
- Gemini API with Zod-validated structured outputs
- Changelog fetching + LLM-based breaking-change extraction
- AST analysis with `@typescript-eslint/parser`
- Full-file patch generation
- Simple Docker sandbox with `--network=bridge` (Phase A) / `--network=none` (Phase B)
- Prettier integration
- PR creation as Drafts
- All UI, dashboard, mascot, design system

The honest tradeoff: v1.0 is less rigorous on the security and confidence dimensions. The mitigation is product framing — every PR explicitly says "medium confidence — manual review required" and opens as Draft. We're not pretending v1.0 is what v1.5 will be.

**v2 capability honesty (added Rev 5):** v2 extends the honesty floor along two new axes.

- **Language-aware confidence ceilings.** Each language's API-diff analyzer (griffe / apidiff / cargo-semver-checks / tsc) has different fidelity. The reachable confidence bucket is **capped by the analyzer's fidelity** and disclosed in "Not Analyzed" (e.g., "Rust cargo-semver-checks covers public API only; private-item changes not analyzed"). A weaker analyzer cannot produce a "high" bucket. This keeps calibration honest as we go polyglot.
- **Honesty-of-action floor (the auto-merge gate).** v1.5's honesty rules governed *framing what the agent knows*; v2 adds *acting on what it knows*. The bar to **act** (auto-merge) is strictly higher than the bar to **suggest** (open a PR): opt-in per repo, default OFF, a narrow category allowlist (patch/minor bumps with no breaking change detected by **both** signals, signals agreeing, tests **and** smoke passing, confidence ≥ a high floor), reversible (a cancelable dwell window), fully logged (every eligibility decision incl. every NO reason), and anti-gaming (the agent never relaxes the envelope or inflates its own confidence to qualify a merge). Codified as **CLAUDE.md §5c**.
- **The eval bench (F19) is the honesty anchor.** A committed baseline report proves the ≥ 90% calibration-accuracy claim with numbers, and a calibration regression release-over-release is a stop-the-line condition. We replace "we think it's calibrated" with "here's the measurement."

## 17b. Phase D — Design Iteration (new in Rev 4)

**Trigger:** v1.0 shipped functionally but the UI does not earn the product's positioning. The "Awwwards-tier cyberpunk + CRT" brief was specified in PRD Rev 3 §13 but executed as generic dark-mode SaaS. Three planned screens were not built. The Live Console exists as an empty shell.

**Purpose:** before v1.5 work begins, do a focused design iteration that (a) establishes a documented, opinionated design language in [DESIGN.md](http://design.md/), (b) rebuilds the visual layer of shipped screens, (c) completes S5/S6/S7 as inline states + permalink routes.

**Outputs:**

- [DESIGN.md](http://design.md/) (sibling to PRD/TRD/CLAUDE.md, source of truth for visual/motion/component decisions)
- Mascot designed in Rive 2D (or R3F low-poly — TBD per [DESIGN.md](http://design.md/) §15 Q2)
- All 6 routes redesigned and rebuilt per [DESIGN.md](http://design.md/) per-screen briefs
- Component inventory built per [DESIGN.md](http://design.md/) §12

**Out of scope for Phase D:** any v1.5 detection / confidence-engine work. Semantic API diffing, asymmetric scoring, search-replace blocks, network allowlist tier-2, rejection learning — all wait for v1.5 (post-Phase-D).

**Phase D timeline:** 2–3 weekends.

| Sub-phase | Scope | Effort |
| --- | --- | --- |
| D1 — Doc + assets | [DESIGN.md](http://DESIGN.md) finalized (✅ done 2026-05-20). Bones designed in Rive 2D per [DESIGN.md](http://DESIGN.md) §8 (idle + 5 core states minimum). Reference screenshots from .mov refs collected and folded into [DESIGN.md](http://DESIGN.md) §7. **Gate D1:** [DESIGN.md](http://DESIGN.md) reviewed and approved by PM; Rive file with state-machine triggers exported (idle, scanning, thinking, detecting, patching, success poses minimum); .mov-derived motion refs added. | 0.5 weekend (~50% remaining — [DESIGN.md](http://DESIGN.md) done; mascot + refs outstanding) |
| D2 — S1 + S4 (motion-heavy) | Boot sequence on S1. Live Console rebuild with three-pane layout, stage lanes, 3D dep graph, mascot integration, particle system. **Gate D2:** S1 boot sequence renders end-to-end; S4 runs a full mock scan with all motion firing. | 1 weekend |
| D3 — S5/S6/S7 inline + permalink | Issue cards, fix detail with Not Analyzed callout, PR confirmation. Inline expansion in S4 + permalink routes. **Gate D3:** full live flow scan→issue→fix→PR works end-to-end with new design; permalink routes render same components statically. | 0.5–1 weekend |
| D4 — S2/S3/S8/S9 redesign | Rest-mode density pass on PAT modal, New Scan, Dashboard, Settings. **Gate D4:** all 6 routes visually consistent, anti-references list ([DESIGN.md](http://design.md/) §13) checked off, manual walk-through complete. | 0.5 weekend |

**Kill criterion:** if Phase D runs past 4 weekends, ship whatever's done and move to v1.5. Don't perpetually polish.

**Then resume v1.5** as planned in §18.

## 18. Phases & Timeline (revised — hard-first ordering + integration gates, dev review Rev 3)

**Build-order principle:** Front-load the high-risk infrastructure (Docker sandbox, AST parsing, GitHub integration) while energy is highest. LLMs hallucinate Docker commands, miss AST/GitHub edge cases, and need manual verification against real repos. UI polish is psychologically rewarding AND what LLMs do most reliably, so it goes last as the dopamine payoff. If the hard infra hits a wall, we find out by end of weekend 2.

**Gate principle (new):** Every phase ends with a mandatory half-day integration gate (per [CLAUDE.md](http://CLAUDE.md) §7.3). No new phase work starts until the previous gate passes. This catches integration failures before they compound across phases — the single biggest risk for vibe-coded projects.

| Phase | Scope | Effort |
| --- | --- | --- |
| 0 — Spec | PRD + TRD + [CLAUDE.md](http://CLAUDE.md) (Rev 3) | done |
| **v1.0 build (hard-first + gates)** |  |  |
| 1A — Project skeleton | Next.js + TS strict + Tailwind + Prisma + design tokens + `.env.example`. Minimal landing placeholder. **Gate 1A**: app boots, env validates, design tokens visible, all checks green | 0.5 weekend |
| 1B — Hard infra: Sandbox + AST + GitHub | Two-phase Docker sandbox tested on 2 fixture repos, AST parser tested against 3 real repos, octokit integration with full error-state handling. **Gate 1B (half-day)**: end-to-end integration test of sandbox + AST + GitHub on `colinhacks/zod`, `pmndrs/zustand`, `tanstack/query`. Smoke test for GitHub auth flow added. | 1.5 weekends (incl. gate) |
| 1C — Agent core | Changelog parser, diagnosis engine, full-file patch generation, REPLAN loop, Prettier post-patch, PR submission as Draft, SSE streaming. **Gate 1C (half-day)**: full scan on one fixture end-to-end; Draft PR actually created on GitHub; REPLAN loop verified. Smoke test for scan flow added. | 1 weekend (incl. gate) |
| 1D — UI polish + demo | Live Console, dashboard, mascot animations across all 9 states, GSAP page transitions, 3D dep graph, sound, visual regression snapshots committed. **Gate 1D (half-day)**: full click-through audit, all buttons functional, all 9 screens reachable, reduce-motion respected, 3 real Draft PRs opened on real OSS repos, Loom recorded, case study v1.0 written. Smoke test for full user journey added. | 1 weekend (incl. gate) |
| **v1.0 SHIPS — apply to jobs with this**
 |  | **4 weekends total** |
| **Phase D — Design Iteration (post v1.0 ship)** | Redesign shipped screens, build missing S5/S6/S7 as inline states + permalink routes, and publish [DESIGN.md](http://DESIGN.md). (No v1.5 detection/confidence work yet.) | 2–3 weekends |
| **Phase D SHIPS —**  | **re-record Loom, update case study** |  |
| **v1.5 build (post v1.0 ship)** |  |  |
| 2A — Semantic diff signal | TypeScript compiler API + api-extractor fallback + AST-only last resort. **Gate 2A**: semantic diff produces expected output on 3 fixture deps with known breaking changes | 1 weekend |
| 2B — Confidence engine | Calibrated scoring with asymmetric math + threshold gating. **Gate 2B**: scoring engine tests pass for all rows in TRD §9.5 scoring table | 0.5 weekend |
| 2C — Patch upgrades | Search-replace blocks for files > 150 lines + fuzzy matching. **Gate 2C**: SR-blocks succeed on 5 fixture patches across small/medium/large files | 1 weekend |
| 2D — Network allowlist + caching | Iptables tier inside Phase A + node_modules layered cache. **Gate 2D**: iptables blocks non-allowlist hosts; cache hit verified on repeated scan | 0.5–1 weekend |
| 2E — Rejection learning + v1.5 demo | RejectionPattern + 3 more demo PRs + Loom v1.5 + case study update. **Gate 2E**: full v1.5 smoke + visual regression all green | 0.5 weekend |
| **v1.5 SHIPS** |  | **+3–4 weekends** |

**Kill criterion:** If v1.0 isn't shipped by end of weekend 5 (one weekend overrun allowed), scope down further (drop test coverage detection entirely, ship dep-upgrade-only) and ship something. Don't keep iterating on a non-shipped product.

**Gate-skip criterion:** Gates are non-negotiable. If a gate fails, fix it before moving on. If a gate is repeatedly failing in the same way (3+ attempts), apply the §12 kill criterion in [CLAUDE.md](http://CLAUDE.md) — surface to owner, propose scope cut.