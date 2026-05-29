# V2_PLAN.md — Mendel v2 Development Plan

> **Status:** DRAFT for owner sign-off. Not yet promoted into PRD/TRD/DESIGN/CLAUDE (those are Notion-mirrored — see §10 for the exact amendments awaiting your go-ahead).
> **Author stance:** written wearing the CTO + PM + Head of Design/UX hats simultaneously.
> **Created:** 2026-05-28
> **Scope decision (owner, 2026-05-28):** v2 stays **local** (Docker sandbox, PAT-session, SQLite). Full cloud rearchitecture is **v3**. Entire v2 roadmap planned, phased. Security worked from in-repo TRD §12 + CLAUDE.md §5/§5b/§10; new rules flagged in §8 + §10.
> **Companion docs:** PRD §12 (v2 roadmap bullets), TRD §15/§17 (v2 column), DESIGN.md (design system — unchanged across phases), STATE.md (v1.0→v1.5 build log + lessons).

---

## 0. How to read this

This document is the bridge between "PRD §12 has 9 roadmap bullets" and "we can start coding Monday." It does five things:

1. Turns the 9 bullets into **8 numbered features (F19–F26)** with the same rigor v1.0/v1.5 features had.
2. Sequences them into **5 sub-releases (v2.0 → v2.4)** with dependency reasoning and a gate between each.
3. Specs the **UI/UX, motion, and graphics** for every new surface so nothing regresses the Phase D design system or the §13 anti-references.
4. Defines **how each feature stitches into the current app** (data model, agent runner, sandbox, SSE, dashboard) without breakage.
5. Folds **every lesson from v1.0–v1.5** into concrete guardrails + proposed spec changes so we don't repeat them.

If you only read one section, read **§4 (sequencing)** and **§10 (spec amendments)**.

---

## 1. Executive summary

v1.5 left us with a calibrated, single-user, TypeScript-only agent that detects breaking changes via two signals, scores them honestly, patches, verifies in a hardened local Docker sandbox, and opens Draft (or threshold-gated) PRs. v2 makes that engine **broader, more autonomous, and measurable** — without leaving the local machine.

The v2 thesis, in one line: *"v1.5 proved Mendel can be honest about one TypeScript dependency. v2 proves it can be honest across languages, across a monorepo, and trustworthy enough to act on its own — and we can prove the calibration with numbers."*

The single most important structural choice: **we build the measurement before the expansion.** The first v2 release is an eval harness + smoke-test layer. Every capability we add afterward (languages, monorepos, auto-merge) is validated against a fixture bench with precision/recall + calibration numbers. This is what lets auto-merge ship responsibly and what gives the portfolio case study real metrics instead of vibes.

---

## 2. Guiding principles (cross-cutting, apply to every feature)

### 2.1 Cloud-readiness without cloud cost (the v3 hook)
Everything we build local must be **shaped** so v3 (cloud) is a deployment project, not a rewrite. Concretely:
- New data-model rows get a **nullable `tenantId`/`ownerId` column from day one** (unused locally, populated in v3). No query assumes single-tenant.
- The sandbox stays **behind an interface** (`SandboxProvider`) so v3 can swap local Docker for E2B/Fly without touching the agent. We extract this interface in v2.0.
- No new code assumes SQLite specifics (no raw SQLite pragmas in app code; Prisma only — already a §5 rule).
- The scheduler/worker (continuous monitoring) is a **separate process** that talks to the same lib, so v3 can move it to a hosted cron/queue unchanged.

### 2.2 Honesty floor extends to autonomy (new — see §8.4)
v1.5's §5b was about *framing what the agent knows*. v2 adds *acting on what it knows* (auto-merge). The honesty floor therefore gets a new clause: **the bar to ACT autonomously is strictly higher than the bar to SUGGEST, and is opt-in, narrow, reversible, and logged.** Detailed rules in §8.4; proposed as a new CLAUDE.md §5c.

### 2.2a Contribution Eligibility — respect the repo's norms (shipped 2026-05-29, CLAUDE.md §5c.1)
A second honesty axis, learned the hard way: unsolicited automated PRs on `sindresorhus/execa` got the account **blocked**. An autonomous agent that spams maintainers is a net-negative product. So Mendel respects each repo's contribution norms before acting:
- **Owned repos** → contribute freely (Drafts fine).
- **Non-owned repos** → **report only by default** (analyze + persist diagnosis, no PR). A PR requires an explicit acknowledgement that the repo welcomes dependency PRs *and* a HIGH bar (confidence ≥ threshold + passing verification). Never a low-confidence Draft on a repo you don't maintain.
- **Hard-blocked** → repo already runs Dependabot/Renovate, or its CONTRIBUTING discourages drive-by PRs.

Compliance ≠ invitation: parsing the CoC/CONTRIBUTING reduces harm but the governing stance is **"contribute where invited."** This reframes Mendel's primary market as owned/org/opted-in repos (how Dependabot/Renovate are actually used) — not drive-by PRs on strangers' repos. Implemented in `lib/agent/eligibility.ts`, gated in the runner, opt-in via the New Scan acknowledgement checkbox.

### 2.3 Every lesson from v1.x is a guardrail, not a memory
The §7.2a regime (no dead controls, no decorative-only data viz, mandatory spec-conformance audit, spec-deviation protocol) and the §11b "verify against a real fixture" rules **apply unchanged to v2** and are extended per-capability in §9. The recurring pattern that bit us — *plausible code that compiles but doesn't run* (Docker flags, AST APIs, SSE plumbing, regex edge cases) — is exactly what multi-language + smoke-test + auto-merge will stress. Real-fixture verification is mandatory, not optional, for all of v2.

### 2.4 Design system is locked; we extend, never reinvent
DESIGN.md's color semantics, typography, 3-mode map (boot/running/rest), mascot rules, and anti-references are **unchanged**. Every new screen declares its mode and obeys it. No new H1+subtitle templates, no empty black canvases, no mascot duplication, no mascot speech, no 21st.dev presets. New components extend the §12 inventory; they don't fork it.

---

## 3. Feature catalog (F19–F26)

Renumbered continuing from PRD F18. Each maps to one or more PRD §12 bullets.

| # | Feature | PRD §12 bullet(s) | Release | Risk | Size |
|---|---|---|---|---|---|
| **F19** | Eval Harness + Fixture Bench | "Eval suite against fixture bench" | v2.0 | Low | M |
| **F20** | Smoke-Test Execution (Sandbox Phase C) | "Smoke-test execution (boot the app post-patch)" | v2.0 | Med | M |
| **F21** | Monorepo / Workspace Support | "Monorepo / workspaces support" | v2.1 | Med | L |
| **F22** | "Point at any API" Mode | "Point at any API mode" | v2.1 | Low | M |
| **F23** | Multi-Language Support (Python → Go → Rust) | "Multi-language: Python, Go, Rust" | v2.2 | High | XL (sub-phased) |
| **F24** | Auto-Merge for High-Confidence Categories | "Auto-merge for high-confidence categories" | v2.3 | High | M |
| **F25** | Continuous Monitoring (cron-triggered scans) | "Continuous monitoring (cron-triggered scans)" | v2.3 | Med | L |
| **F26** | MCP Server (Mendel as a callable agent) | "MCP server: expose Mendel as a callable agent" | v2.3 | Low | M |

**Deferred to v3** (cloud-coupled, per owner): multi-tenant cloud deployment, hosted sandbox (E2B/Fly), NextAuth OAuth, hosted DB, Sentry, distributed cache. These are listed in §12 as the v3 pre-brief so v2's interfaces anticipate them.

---

## 4. Release sequencing & dependency rationale

```
v2.0  Measure & Verify   →  F19 Eval Harness, F20 Smoke-Test, SandboxProvider iface, AgentLog revival
        │  (gate: bench green on v1.5 baseline; Phase C boots a fixture app; calibration report renders)
        ▼
v2.1  Broader Repos       →  F21 Monorepo, F22 Point-at-any-API  (+ Mocha/AVA runners ride along)
        │  (gate: monorepo fixture scans per-package cleanly; API inspector report shareable)
        ▼
v2.2  Polyglot            →  F23 language layer → F23a Python → F23b Go → F23c Rust
        │  (gate per language: real fixture repo scanned end-to-end + bench scores recorded)
        ▼
v2.3  Autonomy            →  F24 Auto-Merge, F25 Continuous Monitoring, F26 MCP Server
        │  (gate: auto-merge only fires inside its safety envelope on a fixture; monitor loop runs headless; MCP tools callable)
        ▼
v2.4  Ship & Prove        →  Loom v2, case study v2, published bench results, ≥3 more real PRs on harder/polyglot repos
```

**Why this order (CTO reasoning):**
- **F19/F20 first** because every later feature needs a way to prove it didn't regress calibration. Auto-merge *cannot* ship responsibly without (a) the bench proving calibration accuracy and (b) smoke-test raising the verification ceiling above "tests passed." Building these first is the de-risking move.
- **F21/F22 before F23** because they're language-agnostic-ish (monorepo is structural; API inspector reuses existing TS signals) and lower-risk — they keep momentum while the big polyglot epic is still ahead.
- **F23 is the long pole** and is sub-phased per language so each ships and is benched independently. Python first (highest demand, mature API-diff tooling), then Go, then Rust.
- **F24/F25/F26 last** because autonomy should sit on the most capable, best-measured engine. Auto-merge depends on F19+F20; continuous monitoring is most useful once multi-language widens the addressable repo set; MCP is self-contained and a good final "wow."

---

## 5. Detailed feature plans

Each feature uses the same block structure: **What/Why · Data & lib · API · Sandbox · UI/UX/Motion · Integration (no-breakage) · Security & honesty · Verification · Lessons applied.**

---

### RELEASE v2.0 — Measure & Verify

#### F19 — Eval Harness + Fixture Bench

**What/Why.** A repeatable harness that runs the agent against a curated set of fixture cases with known-correct expected outcomes, and scores: breaking-change detection precision/recall, confidence-calibration accuracy (do high-confidence calls actually correspond to real breaking changes?), patch validity, and regression rate. This is the instrument that turns PRD §8 success metrics from aspirations into a dashboard.

**Data & lib.**
- New dir `lib/eval/`: `bench-runner.ts` (loads fixtures, invokes the agent's signal+scoring pipeline in a *no-PR, no-network-write* mode), `scoring.ts` (precision/recall/calibration math, Zod-validated report schema), `fixtures/` index.
- New dir `eval/fixtures/`: each case = `{ packageName, fromVersion, toVersion, expected: { breakingChanges[], shouldDetect, expectedBucket } }` as JSON, plus optional pinned tarballs for offline runs.
- No new Prisma model needed for v2.0 (reports written to `eval/reports/<timestamp>.json`, gitignored except a committed baseline). Optional `EvalRun` model deferred unless we want history in-app.

**API.** None (CLI-only): `pnpm eval` script. Eval must not be reachable from the web app (it's a dev/CI instrument, not a user surface) — avoids adding an unauthenticated heavy endpoint.

**Sandbox.** Reuses the existing two-phase sandbox for any case that needs real install/test; pure signal-diff cases run offline against pinned tarballs (fast bench).

**UI/UX/Motion.** Primarily CLI + a committed markdown/JSON report. **Optional** (recommended for the portfolio): a read-only `/dev/eval` page (dev-mode only, not in the authed app nav) rendering the latest bench report as Nixtio-dense stat cards + a calibration scatter (predicted bucket vs. actual correctness). Rest mode. Reuses `<StatCard>`, `<PanelFrame>`. No mascot (dev surface). This is genuinely-wired data viz (§7.2a step 5 compliant) — not decoration.

**Integration (no-breakage).** Pure additive. The bench imports `parseSemanticDiff`, `parseBreakingChanges`, `calculateConfidence` directly — the same functions the runner uses — so the bench measures the *real* pipeline, not a copy. Zero changes to runtime app code.

**Security & honesty.** Bench runs offline-first (pinned tarballs) to avoid hammering npm. The committed **baseline report is the honesty anchor**: every later release must re-run the bench and show the delta. A calibration regression is a stop-the-line condition (new kill criterion, §11).

**Verification.** The bench *is* verification infrastructure; it self-tests via a synthetic fixture with a hand-computed expected score (so we know the scorer is right). §11b discipline: validate the bench against a real npm pair (axios 0.24→0.27, already known) before trusting it.

**Lessons applied.** Directly answers the v1.x pattern of "we think calibration is honest" with "here's the number." Also gives every subsequent v2 feature a regression net.

---

#### F20 — Smoke-Test Execution (Sandbox Phase C)

**What/Why.** Today verification = Phase A (install) + Phase B (typecheck/test, `--network=none`). Phase B proves "tests pass," not "the app still boots." F20 adds an optional **Phase C**: after the patch, attempt to *boot* the project (its `start`/`dev`/`serve` command, or a detected entrypoint) in the sandbox and confirm it comes up without crashing within a timeout, hitting a health route if one is detectable. This raises the verification ceiling — and is a **hard prerequisite for auto-merge** (F24).

**Data & lib.**
- `lib/sandbox/smoke.ts` — `runPhaseC(config): SmokeResult`. Detects a boot command (heuristics: `scripts.start`, `scripts.dev`, a `main`/`bin` entry, framework signatures), runs it with a short timeout, watches stdout for a "listening"/"ready" signal or a crash, optionally curls `localhost:<port>/` or `/health`.
- `SmokeResult` Zod schema: `{ attempted, booted, signal, durationMs, logTail, reason }`. Honest by construction: `booted: false` with a reason is a valid, non-fatal outcome.
- Extends `lib/sandbox/types.ts` `SandboxConfig` with `smokeTest?: { enabled, command?, healthPath?, readyPattern?, timeoutMs }`.

**API.** No new route; `confidenceThreshold`-style optional flag on `POST /api/scans` (`smokeTest: boolean`, default true for v2). Zod-validated.

**Sandbox.** Phase C runs under the **same `--network=none` constraint as Phase B** (a booting app shouldn't need egress; if it does, that's surfaced honestly, not granted). Non-root, timeout (default 90s, capped), 2GB. Container torn down after. **§11b.1 real-container verification mandatory** — we've been bitten by Docker hallucination before (the iptables `$?`-expansion bug, the entrypoint privilege bug). A `pnpm test:docker` case must boot a real fixture app and assert both the boot-success and boot-failure paths.

**UI/UX/Motion.** S4 (Live Console): the **StageLane gains a 5th lane** — `SCAN → DIAGNOSE → PATCH → VERIFY → SMOKE`. Mascot gets a **"verifying" pose reuse** during smoke (clipboard/checkmark — no new pose needed). Smoke result renders inside the issue card's expanded body as a new sub-block under Verification Results: a small bordered panel, phosphor when booted, amber when "not attempted / inconclusive," danger when crashed — with the `logTail` in a `<TerminalLog context="rest">`. Motion: the new lane pill slides in per §7 running-mode spec (280ms cubic-bezier). Honesty: a smoke that *didn't attempt* (no boot command found) shows amber "boot not verified," never a fake green.

**Integration (no-breakage).** Phase C is **opt-in and additive** — existing scans behave identically with `smokeTest:false`. The runner calls it between VERIFY and SCORE; a smoke failure **caps confidence** (extends the existing verification-cap logic in `lib/agent/confidence/score.ts` — "boot failed" caps overall like "verification failed" does today). StageLane already supports a configurable lane set, so adding a lane is a data change, not a rewrite.

**Security & honesty.** Booting arbitrary OSS code is the riskiest sandbox operation yet → strictest network isolation (none), shortest practical timeout, hard memory cap, mandatory teardown. New §5 sandbox sub-rule (see §8). Honest framing: smoke result is reported as "what we observed," with explicit "Not Analyzed" carve-outs (e.g., "booted but no runtime exercise of changed code paths").

**Verification.** §7.2 full gate + §11b.1 real-container test (boot-success fixture + boot-crash fixture). Bench (F19) gains smoke-aware cases.

**Lessons applied.** §11b.1 (Docker hallucination) front and center; honest "didn't attempt" state per §5b; no dead UI (the smoke panel only renders when `attempted`).

---

#### v2.0 supporting work (rides with F19/F20)

- **`SandboxProvider` interface extraction** (cloud-readiness, §2.1): wrap the current Docker calls in `lib/sandbox/provider.ts` exposing `runInstall/runTest/runSmoke/teardown`. The local impl is today's executor. v3 adds an E2B impl. Pure refactor, fully test-covered before/after (snapshot the executor's behavior).
- **AgentLog revival** (TRD §10 model exists, removed in v1.0 Fix #14 as unused): reintroduce `AgentLog` writes for per-phase timing + tokens. F19's bench and F25's monitoring both want this. Add nullable `tenantId` per §2.1. New `prisma db push` (project convention — no migration history).

**v2.0 GATE (half-day, per CLAUDE.md §7.3):**
- `pnpm eval` runs green against the committed v1.5 baseline; calibration report renders.
- Phase C boots a real fixture app (success) and correctly reports a crash fixture (failure) — verified in a real container.
- `SandboxProvider` refactor passes the full v1.5 test suite unchanged (no behavior drift).
- `pnpm typecheck && pnpm lint && pnpm test && pnpm smoke` all green. Visual regression baselines unchanged (no UI besides the optional /dev/eval + the smoke sub-panel, which gets its own baseline).

---

### RELEASE v2.1 — Broader Repos

#### F21 — Monorepo / Workspace Support

**What/Why.** v1.0/v1.5 explicitly reject monorepos (CLAUDE.md §11 forbidden, PRD §7 non-goal "v2 territory"). F21 lifts that: detect a workspace root (pnpm-workspace.yaml / `workspaces` field / nx/turbo configs), enumerate member packages, and scan **per-package** with the existing pipeline, grouping results under one scan.

**Data & lib.**
- `lib/agent/workspace/detect.ts` — `detectWorkspace(repoPath): { kind, packages: PackageRef[] }` (`PackageRef = { name, dir, manifestPath }`).
- `Scan` gains nullable `workspaceKind String?` + a new child model `ScanPackage` (`id, scanId, name, dir, depsCount, issuesFound`) so issues can be grouped by member package. Issues gain nullable `packageDir String?`.
- The runner loops packages; install is workspace-aware (one install at root for hoisted deps; per-package where isolated).

**API.** `POST /api/scans` unchanged in shape; the runner detects monorepo automatically. `GET /api/scans/[id]` response gains `packages: PackageVM[]`. Zod-extended.

**Sandbox.** One Phase A at the workspace root (respects the lockfile + cache key — the existing cache keys off the root lockfile, which is correct for a workspace). Phase B/C scoped per affected package.

**UI/UX/Motion.** S4 must show structure without clutter (anti-ref: no empty space, but also no overwhelming wall):
- **Center pane:** issue cards gain a small **package chip** (`pkg: @scope/name`) in the header; cards group under collapsible package sections when >1 package has issues.
- **Right pane (dep graph):** the `<DepGraph>` (the functional 2D graph that replaced the decorative 3D one) gains **package clustering** — nodes group/tint by member package, with a package filter alongside the existing All/Issues/Delivered chips. This is a real interaction on real data (§7.2a step 5 compliant).
- **Left pane:** mini-stats add "packages: N · with issues: M."
- **New Scan (S3):** after URL parse, if a monorepo is detected, show a compact "monorepo detected · N packages" line in the constraints panel area (informational, amber-neutral, honest about scope). Motion per rest-mode spec.

**Integration (no-breakage).** Single-package repos take the exact v1.5 path (`detectWorkspace` returns one implicit package = repo root) — the loop runs once, UI shows no package chips. So existing behavior is a special case of the new code, not a branch to maintain. The dep graph and issue cards already render from arrays; we're adding a grouping key, not restructuring.

**Security & honesty.** Token budget is now per-package within the per-scan cap (500k) — the runner ranks packages by dep-staleness and stops at the cap, logging which packages were skipped (honest, like the per-file skip log in W#7). "Not Analyzed" gains "packages not analyzed (budget): …".

**Verification.** Fixture: a real small pnpm/turbo monorepo. §7.2 gate. Bench (F19) gains a monorepo case. §11b: verify install actually resolves workspace deps in the sandbox (a classic place for Docker/pm hallucination).

**Lessons applied.** Honest budget-skip logging (W#7 pattern); functional dep-graph clustering not decoration (§7.2a); special-case-not-branch keeps the single-package path untouched.

---

#### F22 — "Point at any API" Mode

**What/Why.** Let the user point Mendel at *a package + version range* (no repo, no PR) and get a **breaking-change report** — pure analysis. Reuses the semantic-diff + changelog signals and the confidence scorer; produces a shareable report instead of a patch/PR. Great low-risk feature and a strong standalone portfolio artifact ("paste any npm package, see what breaks").

**Data & lib.**
- New `lib/agent/inspect.ts` — `inspectApi(packageName, fromVersion, toVersion): ApiReport` orchestrating `parseSemanticDiff` + `parseBreakingChanges` + a *report-only* confidence call (no verification → confidence honestly capped, no smoke, no patch).
- New model `Inspection` (`id, packageName, fromVersion, toVersion, report Json, createdAt, tenantId String?`).

**API.** New route `POST /api/inspect` (Zod: package name ≤214 chars, two semver strings; rate-limited 10/min like scans). `GET /api/inspect/[id]` for the permalink.

**Sandbox.** None for the offline path (tarball fetch + diff only). If the user opts into "verify against my code," it falls back to the scan flow — but base mode is sandbox-free and fast.

**UI/UX/Motion.** New route `/inspect` (rest mode primarily, with a brief running flourish):
- Input row: package name + from/to version (autocomplete latest from npm). Mascot in **scanning → thinking** pose during the ~1–2s analysis (reusing existing poses; the analysis is fast so motion is a short kinetic beat, not a full S4).
- Result: reuses `<IssueCard context="rest">` + `<NotAnalyzedCallout>` + `<DiffViewer>` + `<ConfidenceBadge>` — *the same components as a scan issue*, so visual language is identical and zero new card design is needed. The report is loud about what it *didn't* do ("no repo context — affected-sites analysis skipped; confidence capped at medium").
- Permalink `/inspect/[id]` for case-study sharing (consistent with the §10 hybrid permalink philosophy).

**Integration (no-breakage).** Entirely additive new route + endpoint. Reuses signal/scoring libs and the existing rest-mode components verbatim. New nav entry in the (app) sidebar ("Inspect API") — wired, not a dead link.

**Security & honesty.** No PR, no merge, no repo write — lowest-risk feature. Honesty: report mode confidence is **structurally capped** (no verification, no affected-sites) and says so. Cannot show "high" — analogous to v1.0's amber-only rule.

**Verification.** §7.2 gate; reuses F19 bench cases (the inspector and the scan use the same signal pipeline). E2E: paste a known pair, assert the report renders + permalink resolves.

**Lessons applied.** Component reuse over reinvention (avoids design drift); structural honesty cap (§5b); wired nav (§7.2a).

**v2.1 GATE:** monorepo fixture scans per-package with grouped UI; inspector report renders + shares; bench updated; full verification suite green; new visual baselines for `/inspect` + monorepo S4.

---

### RELEASE v2.2 — Polyglot (the long pole, sub-phased)

#### F23 — Multi-Language Support

**What/Why.** The biggest v2 epic: extend detection/diff/patch/verify to **Python, Go, Rust**. The honest engineering reality is that each language has its *own* ecosystem tooling — there is no universal API-diff. We lean on mature, real, shell-invokable tools per language (no hallucinated universal parser):

| Language | Pkg manager(s) | Test runner | **Semantic API diff tool** | Sandbox base |
|---|---|---|---|---|
| Python | pip, poetry, uv | pytest | **`griffe check`** (real: detects API breaking changes between versions) | `python:3.13-slim` |
| Go | go modules | `go test` | **`golang.org/x/exp/cmd/apidiff`** (real: API compatibility report) | `golang:1.x` |
| Rust | cargo | `cargo test` | **`cargo-semver-checks`** / `cargo-public-api` (real: semver-aware API diff) | `rust:1.x-slim` |
| TS/JS | pnpm/npm/yarn | vitest/jest | tsc compiler API (existing) | `node:20` (existing) |

This is the codeable path: the **changelog signal is already language-agnostic** (it fetches CHANGELOG/releases), and the semantic-diff signal becomes a **per-language strategy** that shells to the right tool *inside the sandbox*.

**Architecture — language abstraction layer (built first, F23 core):**
- `lib/agent/lang/types.ts` — `LanguageAdapter` interface: `detect(repoPath)`, `installCommand`, `testCommand`, `semanticDiff(pkg, from, to, sandbox)`, `patchHints`, `manifestFile`, `sandboxImage`.
- `lib/agent/lang/typescript.ts` — wraps the existing TS pipeline behind the adapter (refactor-in-place, behavior-snapshot-tested first).
- `lib/agent/lang/python.ts`, `go.ts`, `rust.ts` — added in F23a/b/c.
- `lib/agent/lang/registry.ts` — `selectAdapter(repoPath): LanguageAdapter`.
- The runner becomes language-agnostic: it asks the registry for an adapter and drives the same phase flow. The confidence scorer is **already language-agnostic** (it consumes signal outputs, not language specifics) — a key reason this is feasible.

**Data & lib.** `Scan` gains nullable `language String?`; `Issue` gains nullable `language String?`. Semantic-diff output schema (TRD §6.4) is reused as-is — each adapter normalizes its tool's output into the existing `SemanticDiff` shape (`removedExports`, `signatureChanges`, `newDeprecations`, `coveragePercent`, `analysisTier`, `unanalyzableSymbols`). `analysisTier` enum extends with `'griffe' | 'apidiff' | 'cargo-semver'` (downstream confidence + CalibrationSnapshot already render arbitrary tier strings).

**API.** No shape change — language auto-detected. `GET /api/scans/[id]` surfaces `language`.

**Sandbox.** Per-language Docker images, each following the **same two-phase + Phase C + iptables-allowlist + cache** architecture generalized via `SandboxProvider` (built in v2.0). Cache keys extend to include language + image tag. Each new image gets a **real-container egress test** (§11b.1) like the node image already has.

**UI/UX/Motion.** The design system already encodes everything language-neutrally; additions are minimal and must NOT over-decorate:
- **Language indicator:** a small `<LangBadge>` (new, tiny — TS/PY/GO/RS as a mono label chip in the existing label style) on issue cards + the S4 left pane + dashboard rows. Uses existing tokens (cyan chrome accent), no new colors.
- **Dep graph:** node tooltips show language-appropriate version strings; no structural change.
- **New Scan (S3):** after URL parse, show detected language in the constraints panel ("language: Python · analyzer: griffe · confidence tiering adjusted"). Honest about analyzer capability per language.
- **Mascot:** **no new pose.** Bones is language-agnostic (anti-ref: don't gimmick the mascot). The operator runs whatever machine; the badge tells the language.
- Motion: none new — language is metadata, rendered in rest/running styles already defined.

**Integration (no-breakage).** The TS adapter wraps today's exact pipeline; a TS repo produces byte-identical behavior post-refactor (snapshot-tested). New languages are new adapters — the runner, scorer, UI components, and SSE stream are untouched in structure. This is the cleanest possible extension because the confidence engine was already signal-shaped, not language-shaped.

**Security & honesty.** Each language's analyzer has different fidelity → **per-language confidence tiering** (e.g., griffe is strong → can reach higher buckets; a language with weaker tooling caps lower). This is encoded honestly in the scorer config and surfaced in "Not Analyzed" ("Rust semver-checks covers public API only; private-item changes not analyzed"). New §5b clause: *confidence ceilings are language-aware and disclosed.* Sandbox: each image non-root, network-none on Phase B/C, allowlist on Phase A, real-container-verified.

**Verification.** Sub-phased — **each language gets its own gate**: a real public fixture repo for that language scanned end-to-end (detect→diff→patch→verify→smoke), bench cases added, real-container sandbox egress test, §7.2 full gate. We do NOT declare F23 done until all three languages pass their gate OR the owner explicitly descopes a language (spec-deviation protocol).

**Kill-criterion (per CLAUDE.md §12):** if a language's API-diff tool proves unreliable (>30% wrong on bench fixtures), fall back to **changelog-only + AST-fingerprint** for that language with an honest lower confidence ceiling, document in STATE.md, surface to owner. Don't bash on a broken analyzer.

**Sub-phase order:** F23 core (abstraction) → **F23a Python** → **F23b Go** → **F23c Rust**. Each independently shippable + benched.

**Lessons applied.** Cite real ecosystem tools, not a hallucinated universal diff (§11b "verify against official docs, not training data"); refactor-behind-interface with behavior snapshots (the SandboxProvider pattern); honest per-language ceilings (§5b); no mascot gimmickry (§8 anti-rule); kill-criterion for unreliable tooling (§12).

---

### RELEASE v2.3 — Autonomy

#### F24 — Auto-Merge for High-Confidence Categories

**What/Why.** The first time Mendel *acts* instead of *suggests*. For a narrow, opt-in set of change categories that clear a strict bar, Mendel merges its own PR. This is high-blast-radius and demands the new honesty-of-action floor (§8.4 / proposed CLAUDE.md §5c).

**The safety envelope (ALL must hold, AND repo opted-in, AND default OFF):**
1. Repo is explicitly opted into auto-merge (per-repo setting) **and** the PAT owner has merge rights.
2. Change category is on the allowlist: **patch/minor version bumps with NO breaking change detected by *both* signals.** (Major bumps, any detected breaking change, any signal disagreement → never auto-merge.)
3. Confidence score ≥ a high floor (proposed default **90**, configurable, hard-clamped ≥ the standard threshold).
4. **Phase B (tests) passed AND Phase C (smoke) booted** — F20 is a hard dependency.
5. No prior rejection pattern for this dep/category (the rejection-learning loop, F16, gates it).
6. A mandatory **dry-run dwell**: even when eligible, the PR opens as a normal (non-draft) PR and auto-merges only after a configurable **delay window** (default 0 in demo, but the mechanism exists) — reversible by the user before it lands.

**Data & lib.**
- `lib/agent/automerge/policy.ts` — pure `evaluateAutoMerge(context): { eligible, reasons[] }` (every NO reason recorded — never a silent skip).
- `lib/github/index.ts` — `mergePullRequest(owner, repo, number, method)` (octokit; method default `squash`). Already-have createDraftPR/createPR.
- `RepoSetting` new model (`id, repoUrl, autoMergeEnabled Boolean @default(false), autoMergeMaxBump String, tenantId String?`). Default-off is enforced at the schema default.
- Audit: every auto-merge writes an `AgentLog` entry (phase `AUTOMERGE`) with the full eligibility decision.

**API.** `PATCH /api/repos/settings` (Zod, rate-limited) to toggle per-repo auto-merge. The runner consults policy; no separate "do merge" endpoint exposed to the client (the agent acts, the client configures).

**UI/UX/Motion.**
- **Settings (S9):** new "Auto-Merge" PanelFrame — a per-repo list with toggles (default OFF, visibly so), the max-bump selector, and a **loud honest disclosure** of the envelope ("Mendel will merge only patch/minor bumps with no breaking change, both signals agreeing, tests + boot passing, confidence ≥ 90. You can disable this anytime."). This panel is the trust surface — it gets the same care as the v1.0 confidence banner.
- **S4 / issue card:** a new terminal state beyond "PR opened" → **"AUTO-MERGED ✓"** with phosphor (success) styling and the merge SHA + link. Mascot fires the existing **success burst** (no new pose; reuse). For *eligible-but-held* PRs, an amber "auto-merge pending (window: Xs) — cancel?" state with a working cancel control (§7.2a no dead controls).
- **Dashboard (S8):** new stat card "Auto-Merged" alongside PRs Opened/Merged; the CalibrationSnapshot gains an auto-merge slice (how many auto-merges, their confidence distribution) — real data, real interaction.
- Motion: auto-merge success = the §7 success burst (lime ring 800ms). The "pending window" uses a countdown ring (mechanical, tabular-nums) — honest and cancelable.

**Integration (no-breakage).** Auto-merge is a **post-SUBMIT branch** in the runner gated entirely by `evaluateAutoMerge`. With every repo defaulting OFF, existing behavior is identical — no scan auto-merges unless explicitly configured. The PR-state poller (F16 / W#10) already tracks merge state, so an auto-merged PR flows through the existing `pr-merged` status path.

**Security & honesty.** This is where §8.4 lives. New CLAUDE.md §5c (proposed): the bar to act > bar to suggest; opt-in; narrow category allowlist; reversible (dwell window); fully logged; never on signal disagreement or any detected breaking change; never raises its own confidence to qualify (anti-gaming, mirrors §5b "don't inflate to ship more"). Forbidden pattern (proposed CLAUDE.md §11 addition): *auto-merging anything with a detected breaking change, a signal disagreement, a failed/absent smoke test, or a confidence below the high floor — even if the user sets a low threshold (clamped).* 

**Verification.** Policy is pure → exhaustively unit-tested for every envelope boundary (each NO reason). A **real fixture PR on a repo you own** that is deliberately eligible (clean patch bump) auto-merges; one with an injected breaking change does NOT (asserted). §7.2 gate. Bench (F19) gains an "auto-merge eligibility precision" metric.

**Lessons applied.** Pure-policy + boundary tests (the threshold-gate W#3 pattern that caught real bugs); every-NO-reason-logged (no silent drops); default-off at schema level; clamp to prevent misconfiguration unlocking unsafe behavior (W#3 clamp lesson); no confidence self-inflation (§5b).

---

#### F25 — Continuous Monitoring (cron-triggered scans)

**What/Why.** Turn Mendel from on-demand into an autonomous local service: a **watchlist** of repos, scanned on a schedule by a **separate worker process**, surfacing new issues (and, where F24 is enabled, acting on them). Local-appropriate: a standalone `pnpm monitor` worker using a cron scheduler — not dependent on the Next.js dev server being a daemon.

**Data & lib.**
- `WatchlistEntry` model (`id, repoUrl, schedule String (cron expr), enabled Boolean @default(true), lastScanAt, nextScanAt, tenantId String?`).
- `worker/monitor.ts` — a long-running Node process using **`node-cron`** (real, dep-light). Reads the watchlist, invokes the **same `runScan`** the API uses (shared lib — no logic duplication, cloud-portable per §2.1), records results, respects a global concurrency of 1 (matches TRD §14 "1 serial scan/user" — the worker queues, never parallel-hammers Docker).
- Notifications: local-first — write a `Notification` row + surface in-app; optional desktop notification / webhook is a v2.3 stretch (no email infra locally).

**API.** `GET/POST/PATCH/DELETE /api/watchlist` (Zod, rate-limited, session-gated). The worker reads the DB directly (it's a trusted local process), not via HTTP.

**UI/UX/Motion.** New route `/watchlist` (rest mode, Nixtio-dense — anti-ref: no empty canvas):
- A dense table of watched repos: repo, schedule (human-readable "every 6h"), last result (status dot + issues found), next run (relative time, tabular-nums), enable toggle, auto-merge indicator if F24-on. Reuses `<StatCard>` header row + the dashboard table styling. Add/edit row with a cron-or-preset picker (presets: hourly/6h/daily/weekly — honest about what local uptime allows: "runs only while the monitor process is up").
- **Dashboard (S8):** a "Monitoring" strip — N repos watched, next scan countdown, recent autonomous activity feed. Real data, real links to scans.
- **Mascot:** propose **one new pose — "watching"** (idle variant: Bones with a small radar/scope, slow sweep) for the monitoring-active state in the dashboard/watchlist. This is the *one* justified new pose in v2 (it represents a genuinely new agent state — passive vigilance — not a gimmick). Honors §8 (reaction, not speech; single instance).
- Motion: rest-mode idle life (the "watching" sweep is a slow idle loop, reduced-motion → static). Countdown timers use number-flicker-on-update per §7.

**Integration (no-breakage).** The worker is **out-of-process and optional** — the web app runs exactly as today without it. It imports `runScan` from the same lib (the function already takes `RunScanOptions`), so monitoring scans are real scans appearing in the same dashboard/history. The SSE live console isn't involved (monitoring is headless); completed monitored scans render in playback mode like any completed scan.

**Security & honesty.** The worker uses the same encrypted-PAT-from-DB path as F16's poller (already built). Rate-limited self-imposed: serial scans, backoff, respects npm/GitHub limits (the W#1 retry-classification + W#10 poller patterns). Honest scheduling disclosure: "monitoring runs only while your machine + the monitor process are up" (no false promise of cloud-grade always-on — that's v3). New §5 rule: the worker process gets the same secret-handling + Zod + Prisma-only constraints as API routes.

**Verification.** Worker tested with a fake clock + injected scan fn (no real cron wait). A real end-to-end: add a repo, trigger an immediate run, see it land in history. §7.2 gate. §11b: verify the cron actually fires and the serial queue prevents parallel Docker contention.

**Lessons applied.** Shared-lib not duplicated logic (cloud-portable); serial-queue respects the single-scan constraint; honest about local-uptime limits (don't overpromise); reuse the encrypted-PAT + retry patterns already proven.

---

#### F26 — MCP Server (Mendel as a callable agent)

**What/Why.** Expose Mendel's capabilities as MCP tools so other agents/clients (Claude Code, etc.) can call it: `mendel_scan_repo`, `mendel_get_scan`, `mendel_inspect_api`, `mendel_list_issues`. Self-contained, low-risk, high portfolio value ("my agent is itself a callable tool").

**Data & lib.**
- `mcp/server.ts` — built with **`@modelcontextprotocol/sdk`** (real). Tools wrap the existing `runScan`, `inspectApi`, and DB reads. Stdio transport for local use.
- No new data model (reads/writes existing tables via the same lib).

**API.** Not an HTTP route — an MCP stdio server launched via `pnpm mcp`. (HTTP/SSE MCP transport is a v3 concern when hosted.)

**UI/UX/Motion.** Minimal: a **Settings (S9) "MCP Server" PanelFrame** showing status (how to launch, which tools are exposed, a copyable config snippet for adding Mendel to an MCP client). Rest mode, reuses the diagnostics-panel styling. No mascot. This is the honest "here's how to wire it" surface — wired (copy buttons work), not decorative.

**Integration (no-breakage).** Entirely additive, out-of-process. Reuses the exact lib functions. The web app is unaffected.

**Security & honesty.** MCP tools enforce the **same Zod validation, rate limits (in-process), and honesty framing** as the HTTP routes — an MCP caller cannot bypass the confidence/draft/auto-merge rules (the tool calls `runScan`, which carries all gating). PAT handling unchanged (encrypted, server-side). New §5 rule: MCP tool inputs are a boundary → Zod-validated like API routes; MCP tools must not expose secrets in responses.

**Verification.** MCP tools tested by invoking the server's tool handlers directly with valid/invalid inputs (schema enforcement) + one real `mendel_inspect_api` call against a known pair. §7.2 gate (no UI beyond the settings panel, which gets a snapshot).

**Lessons applied.** Reuse gated lib functions so honesty rules can't be bypassed; boundary validation; no secret leakage; wired settings panel (§7.2a).

**v2.3 GATE:** auto-merge fires only inside its envelope on fixtures (eligible merges, ineligible doesn't); monitor worker runs a scheduled scan headless end-to-end; MCP tools callable + schema-enforced; bench shows no calibration regression; full verification suite + new visual baselines (Settings auto-merge/MCP panels, /watchlist, dashboard strips).

---

### RELEASE v2.4 — Ship & Prove

- Re-record the **Loom** (now: polyglot scan + monorepo + an auto-merge inside its envelope + the live monitor + the MCP call). ≤ 4–5 min.
- **Case study v2:** the calibration-bench numbers (F19) are the headline — "here's the precision/recall and calibration accuracy, measured." Cover the language-adapter architecture and the honesty-of-action floor.
- **≥ 3 more real PRs** on harder/polyglot public repos (PRD §8 success metric; pushes total ≥ 9).
- Publish the committed bench baseline + the per-release deltas as proof of no calibration regression.

---

## 6. UI/UX, motion & graphics integration strategy (no glitches, no breakage)

The risk in a multi-feature cycle is design entropy — new surfaces drifting from the Phase D language. Controls to prevent it:

1. **Every new screen declares its mode** (boot/running/rest) up front and obeys §7 motion + §5 color rules. v2's new screens: `/inspect` (rest+brief running), `/watchlist` (rest), `/dev/eval` (rest, dev-only). No new modes invented.
2. **Reuse before build.** F22 reuses IssueCard/NotAnalyzed/DiffViewer/ConfidenceBadge verbatim. F24/F25/F26 reuse PanelFrame/StatCard/StatusPill/table chrome. The only genuinely-new components in all of v2: `<LangBadge>` (tiny), the smoke sub-panel (a styled TerminalLog), the auto-merge settings panel, the watchlist table (StatCard+table composition), and the optional eval report panel. Each gets a `/dev/[component]` isolation pass per CLAUDE.md §6b before integration.
3. **One mascot per screen, one new pose total.** v2 adds exactly **one** pose — "watching" (F25). Everything else reuses scanning/thinking/verifying/success/idle. No mascot speech, no duplication (§8 + anti-refs).
4. **Dep graph stays functional, never decorative** (§7.2a step 5): monorepo clustering and language-aware tooltips are real interactions on real data — extensions of the W#10/D4 functional `<DepGraph>`, not a regression to the banned 3D eye-candy.
5. **StageLane extends to 5 lanes** (adds SMOKE) — a data change the component already supports; pills slide per the existing 280ms running-mode spec.
6. **Mandatory §7.2 step-6 spec-conformance audit** (per-screen brief ↔ live screenshot, met/missed) for every new/changed screen before "done." This is the step historically skipped that caused shipped-but-broken UI; it is non-negotiable for v2.
7. **Visual regression baselines** committed for every new/changed route (the v1.5 suite already does this; extend it). Reduced-motion variants tested (the v1.5 `reduced-motion.spec.ts` pattern).
8. **Build-cache hygiene** (STATE 2026-05-22 gotcha): never `pnpm build` while the dev/preview server shares `.next`; the v2 dev workflow doc notes this to avoid the vendor-chunk corruption that bit us.
9. **R3F-vs-vanilla reconciliation (DESIGN §9 drift):** the code uses vanilla Three.js because R3F v8 broke on React 19; DESIGN §9 still says "R3F." v2 either (a) codifies vanilla Three.js in DESIGN §9, or (b) migrates to R3F v9 (React-19-compatible). **Recommendation: option (a)** — vanilla works, the graph is 2D-functional now anyway, and a migration is pure risk with no user benefit. Flagged in §10 as a DESIGN amendment.

---

## 7. Infrastructure & flow

### 7.1 Agent runner — generalized phase flow (after v2)
```
DETECT(language via registry) → SCAN(deps, per-package if monorepo)
  → DIAGNOSE(changelog + per-language semantic-diff, parallel)
  → PATCH(full-file | search-replace, per-file dispatch)
  → VERIFY(Phase A install → Phase B test, network=none)
  → SMOKE(Phase C boot, network=none)            [F20, optional]
  → SCORE(calibrated, language-aware ceilings)
  → SUBMIT(threshold-gated: skip | draft | standard)
  → AUTOMERGE(only if envelope holds)             [F24, opt-in]
  → PERSIST + LOG(AgentLog)                        [revived v2.0]
```
Every box is a function already shaped to be language- and signal-agnostic. The runner orchestrates; adapters and providers vary the implementation. This is why v2 is an *extension*, not a rewrite.

### 7.2 Sandbox — generalized
`SandboxProvider` interface (v2.0) with a local Docker impl. Per-language images (v2.2), each: non-root, two-phase + Phase C, iptables allowlist on Phase A, network=none on B/C, cache-keyed (lockfile + language + image), real-container-egress-tested. v3 swaps in an E2B/Fly provider behind the same interface.

### 7.3 Out-of-process workers
- `worker/monitor.ts` (F25) — node-cron, serial scan queue, shares `runScan`.
- `mcp/server.ts` (F26) — MCP stdio, shares `runScan`/`inspectApi`.
Both read the encrypted PAT from the DB (the F16 path) and carry all gating. Both are cloud-portable (v3: hosted cron / hosted MCP).

### 7.4 Data model evolution (all via `prisma db push`, project convention)
New/changed: `Scan.+workspaceKind,+language`; `Issue.+packageDir,+language`; new `ScanPackage`, `Inspection`, `RepoSetting`, `WatchlistEntry`, `Notification`; revived `AgentLog`. **Every new model carries a nullable `tenantId`** (cloud-readiness, §2.1). Existing rows/queries untouched — all additions nullable/defaulted.

---

## 8. Security & API protocol additions

Working from TRD §12 + CLAUDE.md §5/§5b/§10 (the mirrored Security-First rules). All existing rules still bind. v2 adds:

### 8.1 New API routes (all: Zod-validated, rate-limited, session-gated, generic errors, Prisma-only)
| Route | Method | Rate limit | Notes |
|---|---|---|---|
| `/api/inspect`, `/api/inspect/[id]` | POST/GET | 10/min | F22; no repo write |
| `/api/watchlist` | GET/POST/PATCH/DELETE | 60/min | F25 |
| `/api/repos/settings` | PATCH | 60/min | F24 auto-merge toggle |
(Eval F19 = CLI only; MCP F26 = stdio, not HTTP — both deliberately not web-exposed.)

### 8.2 Sandbox hardening for new operations
- **Phase C (smoke)** runs `--network=none`, non-root, ≤90s, 2GB, mandatory teardown. Booting untrusted code is the highest-risk op → strictest isolation. Every per-language image gets a **real-container egress test** (§11b.1) before use.
- New CLAUDE.md §5 sub-rule (proposed): *Phase C never gets network; if an app can't boot offline, that's reported honestly, not granted egress.*

### 8.3 Secrets, inputs, workers
- Workers (monitor, MCP) are boundaries: Zod-validate all inputs, never log/return secrets, encrypted-PAT-only, Prisma-only. Same rules as API routes.
- `execFile` (not shell) for all new child-process calls (the W#9/W#10 security-hook lesson — no shell = no injection surface) except where a shell is genuinely required (`sh -c` install commands, already isolated).

### 8.4 Honesty-of-action floor (NEW — proposed CLAUDE.md §5c)
The capstone new rule, gating F24:
1. The bar to **act** (auto-merge) is strictly higher than the bar to **suggest** (open a PR).
2. Auto-merge is **opt-in per repo, default OFF**, enforced at the schema default.
3. Only a **narrow category allowlist** is eligible: patch/minor bumps, **no** breaking change detected by **both** signals, signals **agree**, tests **and** smoke pass, confidence ≥ high floor (default 90, clamped).
4. **Never** auto-merge on: any detected breaking change, signal disagreement, failed/absent smoke, confidence below floor, a dep with a prior rejection pattern, or a repo where the PAT lacks merge rights.
5. **Reversible:** an eligible auto-merge respects a dwell window the user can cancel.
6. **Logged:** every eligibility decision (every NO reason) is written to AgentLog — no silent action, no silent skip.
7. **Anti-gaming:** the agent never raises its own confidence or relaxes the envelope to qualify a merge (mirrors §5b "don't inflate to ship more PRs").

### 8.5 Per-language confidence ceilings (extends §5b)
Confidence buckets are **language-aware**: an analyzer's fidelity caps the reachable bucket, disclosed in "Not Analyzed." A weaker analyzer cannot produce a "high" bucket. This keeps the calibration honest across the polyglot expansion.

---

## 9. Testing & verification strategy for v2

v2 keeps the entire v1.5 testing regime (§7.1–§7.8) and adds:

1. **The bench (F19) is first-class verification.** Every release re-runs `pnpm eval`; a **calibration regression is stop-the-line** (new kill criterion). The committed baseline is the contract.
2. **Per-language gates (F23):** each language ships only after a real public fixture repo is scanned end-to-end + benched + its sandbox image egress-tested. No "all three at once" hand-wave.
3. **Real-container Docker tests (§11b.1) extended** to: Phase C boot (success + crash fixtures), every per-language image, the monorepo install path. We have been bitten by Docker hallucination repeatedly (the `$?` expansion, the entrypoint privilege bug, the IPv4 regex) — this is mandatory, gated behind `pnpm test:docker`.
4. **Auto-merge policy (F24):** pure function, exhaustive boundary tests for every envelope clause + a real fixture PR that IS eligible (merges) and one that ISN'T (doesn't).
5. **Worker (F25):** fake-clock + injected-scan unit tests, plus one real scheduled-scan-to-history E2E.
6. **§7.2 step-6 spec-conformance audit** on every new/changed screen — the historically-skipped step is mandatory.
7. **Visual + reduced-motion regression** baselines for every new route.

### Phase gates (half-day each, per CLAUDE.md §7.3)
v2.0, v2.1, v2.2 (×3 language sub-gates), v2.3 — each with its checklist (spelled out per-release above). No next-release work starts until the prior gate passes.

---

## 10. Spec amendments required (PROPOSED — awaiting your sign-off)

**I have NOT edited PRD/TRD/DESIGN/CLAUDE.** They're Notion-mirrored (manual sync) and source-of-truth; per CLAUDE.md §10 (confirm before shared-state changes) and §7.2a (surface spec changes, never deviate silently), I'm listing exact edits for your go-ahead rather than applying them unilaterally. Say the word and I'll apply them in-repo (you sync Notion).

**PRD.md**
- Expand §12 from 9 bullets into F19–F26 (this doc's §3/§5 are the source text). Move "multi-tenant cloud / hosted sandbox" to a new **§12b — v3 (Cloud)**.
- §7 Non-Goals: mark monorepo, multi-language, auto-merge, continuous-monitoring as **now in-scope for v2** (strike the "both phases" framing; they were v1.0/v1.5 non-goals).
- §8 Success Metrics: add a **v2 column** (calibration accuracy from the bench, PR acceptance on polyglot repos, auto-merge precision).
- §17 Capability Honesty: add a v2 paragraph — language-aware confidence ceilings + the honesty-of-action floor.

**TRD.md**
- §6.4: add the **per-language semantic-diff strategy table** (griffe/apidiff/cargo-semver) + the `analysisTier` enum extension.
- §8: add **§8.5 Phase C (smoke-test)** + the **`SandboxProvider` interface** + per-language images.
- §10 Data Model: add `ScanPackage`, `Inspection`, `RepoSetting`, `WatchlistEntry`, `Notification`; revive `AgentLog`; note nullable `tenantId` on new models; add the new `Scan`/`Issue` columns.
- §11 Internal API Routes: add the §8.1 routes; note MCP (stdio) + eval (CLI) are deliberately non-HTTP.
- §9.5: add the **auto-merge eligibility** computation + language-aware ceilings.
- §15: split into **v2 (local: workers + per-language Docker)** vs **v3 (cloud)** clearly.
- §17 roadmap table: fill the v2 column to match this plan.

**DESIGN.md**
- §7: StageLane **5th lane (SMOKE)**.
- §8: add **"watching" pose** (the one new mascot state).
- §9: **reconcile R3F → vanilla Three.js** (recommendation: codify vanilla; the graph is 2D-functional anyway).
- §11: add per-screen briefs for **/inspect, /watchlist**, the **auto-merge & MCP Settings panels**, and the optional **/dev/eval**.
- §12: add `<LangBadge>` + the smoke sub-panel; note all other v2 surfaces reuse existing components.

**CLAUDE.md**
- §1: update phase status — v1.5 engineering complete; **v2 (local) active per V2_PLAN.md**; v3 = cloud.
- §2: add the per-language sandbox images + tools, `node-cron`, `@modelcontextprotocol/sdk`, `griffe`/`apidiff`/`cargo-semver-checks` to the stack table (v2 column).
- §5: add the **Phase C network=none** sub-rule + worker/MCP boundary rules.
- **§5c (NEW): Honesty-of-Action floor** (the §8.4 rules) — non-negotiable, like §5b.
- §11 Forbidden Patterns: add **"auto-merging outside the §5c envelope"** + "exposing eval/MCP as unauthenticated HTTP."
- §3 file structure: add `lib/eval/`, `lib/agent/lang/`, `lib/agent/workspace/`, `lib/agent/automerge/`, `worker/`, `mcp/`.

---

## 11. Lessons learned → codified into v2 (so they don't repeat)

| v1.x lesson (source) | How v2 prevents repeat |
|---|---|
| Decorative-only data viz shipped (the 3D dep graph) — §7.2a | Monorepo clustering + language tooltips are real interactions on real data; no new decorative viz. |
| Dead controls shipped — §7.2a | Every new control (auto-merge toggle, cancel-window, MCP copy, watchlist actions) wired or visibly-disabled. |
| Spec-conformance audit skipped → shipped-but-broken screens — §7.2a step 6 | Mandatory per-screen audit gate for every new/changed v2 screen. |
| Silent spec deviation (mascot textures, decorative graph) — §7.2a | Spec-deviation protocol enforced; the F23 language-tool choices are pre-recorded deviations (§5/§10). |
| "Low priority polish" used as a skip — STATE 2026-05-27 | No skip without owner sign-off; carried as explicit STATE notes. |
| Docker hallucination (`$?`, entrypoint privilege, IPv4 regex) — §11b.1 | Real-container tests mandatory for Phase C + every language image + monorepo install. |
| AST/parser version sensitivity — §11b.2 | Per-language analyzers pinned + fixture-tested against real repos before trust. |
| GitHub API edge cases — §11b.3 | Auto-merge + poller reuse the proven error-classification layer; merge-rights checked before acting. |
| SSE plumbing fiddly + globalThis emitter — §11b.4 | Monitoring is headless (no SSE); live scans keep the proven globalThis emitter; no new SSE surface. |
| R3F v8 broke on React 19 → vanilla Three.js — STATE | DESIGN §9 amended to codify vanilla; no risky R3F migration. |
| Build-cache corruption (shared `.next`) — STATE 2026-05-22 | Documented in the v2 dev workflow; CI/dev never build into a live `.next`. |
| Mascot over-engineered (3D) then simplified (2D) — STATE | Exactly one new pose in all of v2; no 3D mascot revival; reaction-only. |
| Real tests caught real bugs (LRU avg, threshold clamp) — STATE | Pure-function + boundary-test discipline applied to auto-merge policy + smoke + adapters. |
| Confidence-inflation temptation — §5b | §5c anti-gaming clause: never relax the envelope or inflate confidence to auto-merge. |
| Provider/quota fragility — W#1/W#2 | LLM provider abstraction + retry-classification reused unchanged across all v2 LLM calls. |

---

## 12. v3 pre-brief (so v2's interfaces anticipate it)

Not in scope now; listed so we build v2 cloud-ready (§2.1):
- Vercel deploy + NextAuth GitHub OAuth (replaces PAT-session).
- Multi-tenant Postgres (the nullable `tenantId` columns populate here).
- Hosted sandbox via E2B / Fly machines behind the `SandboxProvider` interface (v2 builds the seam).
- Hosted cron/queue for monitoring (v2's worker moves here unchanged).
- HTTP/SSE MCP transport, Sentry, distributed cache.
The discipline: **nothing in v2 may assume single-tenant or local-Docker in a way that forces a v3 rewrite.**

---

## 13. Risks, kill criteria, open questions

**Top risks**
1. **F23 multi-language is the long pole** and the highest hallucination risk (per-ecosystem tooling). Mitigation: language abstraction first, one language at a time, real-fixture gate each, kill-criterion fallback to changelog+AST with honest lower ceiling.
2. **F24 auto-merge blast radius.** Mitigation: §5c floor, default-off, narrow envelope, dwell window, exhaustive boundary tests, real eligible/ineligible fixtures.
3. **Design entropy across many surfaces.** Mitigation: reuse-first, one new pose, mandatory §7.2 step-6 audits + visual regression.
4. **Local-uptime expectations for monitoring.** Mitigation: honest "runs while your machine is up" framing; real always-on is v3.

**New kill criteria (extends CLAUDE.md §12)**
- **Calibration regression on the bench** (F19) → stop-the-line; fix before any new feature.
- A language's API-diff tool **>30% wrong on bench fixtures** → fall back to changelog+AST for that language, lower ceiling, document, surface.
- **Any auto-merge fires outside its envelope in testing** → F24 halts until the policy is provably correct.

**Open questions for you**
1. **Language priority** inside F23 — I've assumed **Python → Go → Rust** (demand + tooling maturity). Override?
2. **Auto-merge dwell window** default — I've proposed a mechanism with a configurable delay (default 0 in demo). Do you want a non-zero default (e.g., 10 min) as a safety habit?
3. **Eval surfacing** — CLI-only, or build the optional read-only `/dev/eval` page for the case study? (I lean: build it — the bench numbers are the strongest portfolio artifact.)
4. **Apply the §10 spec amendments now**, or hold until you've reviewed this plan? (They touch the Notion-mirrored canonical docs.)
5. Anything in the **Security-First Vibe Coding Rules** Notion page that ISN'T already in TRD §12 / CLAUDE.md §5 that I should fold into §8? (I worked from the in-repo mirror; if the Notion page has extra clauses, paste them and I'll reconcile.)

---

*This plan is a draft for sign-off. On approval, the immediate first task is v2.0 / F19 (eval harness) — the instrument everything else is measured against. Per CLAUDE.md §10, I'll write the v2.0 kickoff to STATE.md when we start.*
