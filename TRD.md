# TRD — Mendel

# TRD — Mendel: Technical Requirements Document

> Technical Requirements Document | **Revision 3** | Last updated 2026-05-18
> 

---

## 0. Revisions Log

**Rev 4 (2026-05-28)** — v2 technical specs (local-first; cloud is v3). Companion: [V2_PLAN.md](http://v2_plan.md/) (full phased build plan). Changes:

- **§6.4** — semantic API diffing extended with a **per-language strategy table** (TS=tsc, Python=griffe, Go=apidiff, Rust=cargo-semver-checks); `analysisTier` enum extended.
- **§8** — added **§8.5 Phase C (smoke-test execution)**, **§8.6 `SandboxProvider` interface** (cloud-readiness seam), **§8.7 per-language sandbox images + v2 cache key**.
- **§9.5** — added **auto-merge eligibility** computation + **language-aware confidence ceilings**.
- **§10** — new models `ScanPackage`, `Inspection`, `RepoSetting`, `WatchlistEntry`, `Notification`; revived `AgentLog`; new `Scan`/`Issue` columns; **nullable `tenantId` on every new model** (v3 cloud-readiness).
- **§11** — new routes (`/api/inspect`, `/api/watchlist`, `/api/repos/settings`); MCP (stdio) + eval (CLI) deliberately non-HTTP.
- **§15** — split into **v2 (local: workers + per-language Docker)** vs **v3 (cloud)**.
- **§17** — v2 roadmap column filled to match the plan.

**Rev 3 (2026-05-18)** — second CTO-review pass + capability honesty pass. Split v1 into v1.0 and v1.5. Every Rev 2 feature still lands; just batched.

- **v1.0 sandbox simplification**: Docker network modes (`--network=bridge` for Phase A, `--network=none` for Phase B) instead of iptables-level allowlist. Iptables tier moves to v1.5.
- **v1.0 detection**: changelog-only (Signal A); semantic API diffing (Signal B) moves to v1.5
- **v1.0 confidence**: single "medium — review required" label; calibrated asymmetric scoring moves to v1.5
- **v1.0 patching**: full-file regeneration, max 3 files per issue; search-replace blocks move to v1.5
- **v1.5 confidence math**: asymmetric scoring per CTO Round-2 — AST-detected/changelog-silent = 65–75, not 20
- **v1.5 network**: two-tier allowlist with per-scan opt-in for binary-fetching deps (Puppeteer, Prisma, etc.)
- **v1.5 caching**: layered `node_modules` cache with `pnpm-lock + node + os` key
- Every feature tagged [v1.0] or [v1.5]; sandbox section split

**Rev 2** — first CTO-review pass.

**Rev 1** — initial draft.

---

## 1. System Overview

Single-tenant, local-first app. Runs on the user's machine. Components:

1. **Next.js frontend + API routes** — UI, user actions, state
2. **Agent runtime** — Node.js/TypeScript orchestrating the agent loop
3. **Two-phase sandbox executor** — disposable Docker containers
4. **Local storage** — SQLite via Prisma; encrypted JSON for secrets

External deps (all free-tier): GitHub REST + GraphQL APIs, Google Gemini API (`gemini-2.0-flash`), npm registry API.

## 2. Architecture

```
┌──────────┐    ┌──────────────────┐    ┌───────────────┐
│ Browser  │ ←→ │ Next.js Server   │ ←→ │ Agent Runtime │
│   (UI)   │    │  (API + SSE)     │    │   (Node.js)   │
└──────────┘    └──────────────────┘    └───────┬───────┘
                                                │
          ┌─────────────────────────────────────┼──────────────────┐
          │                    │                │                  │
     ┌────▼────┐         ┌─────▼─────┐    ┌────▼────────┐    ┌────▼────┐
     │ GitHub  │         │  Gemini   │    │  Two-Phase  │    │ SQLite  │
     │   API   │         │    API    │    │   Sandbox   │    │(Prisma) │
     └─────────┘         └───────────┘    │  (Docker)   │    └─────────┘
                                          │ Phase A: net│
                                          │ Phase B: ∅  │
                                          └─────────────┘
```

SSE from agent runtime → API route → browser for live narration with confidence-delta annotations (v1.5 adds the delta annotations).

State persisted in SQLite. Agent state checkpointed to disk every phase for resume-on-crash.

## 3. Tech Stack

| Layer | v1.0 | v1.5 additions |
| --- | --- | --- |
| Framework | Next.js 15 (App Router) | — |
| Language | TypeScript strict | — |
| Styling | Tailwind v4 | — |
| UI primitives | shadcn/ui | — |
| Animation | Framer Motion 11 + GSAP 3 | — |
| 3D | Three.js + React Three Fiber | — |
| State | Zustand | — |
| DB | SQLite + Prisma | — |
| Validation | Zod | — |
| LLM | `@google/generative-ai` | — |
| GitHub | `octokit` | — |
| Sandbox | Docker (Node 20 + pnpm), network modes |   • iptables rules (Alpine) |
| Style normalization | `prettier` | — |
| Semantic diffing | — | `typescript` compiler API + `api-extractor` |
| Logging | Pino | — |
| Testing | Vitest | — |
| Lint | ESLint + Prettier (+ Tailwind plugin) | — |
| Package manager | pnpm |   • npm, yarn detection |

Requirements: Node 20+, pnpm 9+, Docker Desktop, Git, `ENCRYPTION_KEY` ≥ 32 chars.

## 4. Agent Design

Finite state machine. Each phase has defined input/output, accessible tools, failure modes, retry policy.

### 4.1 Phase Flow

**v1.0:**

```
SCAN → DETECT (changelog) → DIAGNOSE → PLAN → PATCH (full-file) → VERIFY (2-phase) → SUBMIT (Draft PR)
  ↑                                                        ↓
  └────────────── REPLAN (max 3 attempts) ─────────────────┘
```

**v1.5 adds:**

```
SCAN → DETECT (changelog ‖ semantic-diff) → DIAGNOSE → PLAN → PATCH (full-file or SR-blocks)
                                                                  → VERIFY → SCORE → SUBMIT
```

Phase descriptions:

- **SCAN** [v1.0] — Clone, parse manifest, detect monorepo (reject if found), identify languages, fetch recent commits
- **DETECT** [v1.0: changelog only; v1.5: + semantic diff in parallel] — Identify candidate issues with metadata
- **DIAGNOSE** [v1.0] — LLM call per issue with Zod-validated structured output; produces classification, evidence, fix plan, "not analyzed" list
- **PLAN** [v1.0] — File-by-file plan with estimated test impact
- **PATCH** [v1.0: full-file regen, max 3 files; v1.5: SR-blocks for > 150 lines, no file cap] — Execute plan, run Prettier post-patch
- **VERIFY** [v1.0: two-phase sandbox with network modes; v1.5: + iptables allowlist] — TypeScript check, lint, tests, build
- **SCORE** [v1.5 only] — Run confidence calculation
- **REPLAN** [v1.0] — On VERIFY failure, feed failure logs into new PLAN
- **SUBMIT** [v1.0: opens as Draft; v1.5: respects user confidence threshold] — Pre-flight dedup check, branch creation, commit, PR

### 4.2 Tool Schema

Each tool has Zod input/output schemas:

**v1.0 tools:**

- `github.cloneRepo(url) → localPath`
- `github.detectMonorepo(localPath) → { isMonorepo: boolean, indicators: string[] }`
- `github.findOpenPRsByHeadPattern(repo, pattern) → PR[]`
- `github.createDraftPR(repo, branch, title, body) → prUrl`
- `github.fetchChangelog(packageName, fromVersion, toVersion) → string`
- `npm.getLatestVersion(packageName) → version`
- `fs.readFile`, `fs.writeFile`, `fs.applyDiff`
- `code.parseAST`, `code.findReferences`
- `code.runTypeCheck`, `code.runLint`, `code.runTests`, `code.runPrettier`
- `llm.complete(prompt, schema) → structuredOutput`

**v1.5 additions:**

- `npm.downloadTarball(packageName, version) → localPath`
- `semantic.diffApiSurface(oldTarball, newTarball) → ApiDiff`
- `code.applySearchReplaceBlock(filePath, search, replace) → { success, fuzzy }`
- `confidence.calculate(signals, verification) → ConfidenceScore`
- `learning.recallRejectionPatterns(depName, changeType) → Pattern[]`

All tool calls logged to `AgentLog` table.

### 4.3 LLM Usage

Structured outputs only. Every LLM call uses Zod schemas; forces JSON.

**Retry on schema-validation failure:**

1. If Zod parse fails, retry with: original prompt + failure message + schema + original output
2. Max 3 retries per call
3. After 3 failures, surface raw output to user

**Token budgets (v1.0):**

- DIAGNOSE: 4k per issue
- PLAN: 8k
- PATCH: 8k per file, max 3 files per issue → 24k per issue
- REPLAN: 12k per retry × 3 = 36k
- Per-issue ceiling: 60k
- Per-scan ceiling: 250k

**Token budgets (v1.5):**

- DIAGNOSE: 4k per issue (unchanged)
- PLAN: 8k (unchanged)
- PATCH: 8k/file full-regen for < 150-line files; 3k/file for SR-blocks; no file cap, prioritize by impact
- Per-issue ceiling: 100k
- Per-scan ceiling: 500k

Hard kill on cap exceeded; state cleanly persisted; user notified.

Model: Gemini 2.0 Flash. v1.5 optionally falls back to Gemini 2.5 Pro for low-confidence diagnoses.

## 5. v1 Scope Constraints

Hard rejections at scan time:

| Condition | v1.0 | v1.5 |
| --- | --- | --- |
| Non-TS/JS repo | Reject | Reject |
| **No tsconfig.json (JS-only)** | **Reject** | **Accept with lower-confidence framing** |
| Monorepo (workspaces field, pnpm-workspace.yaml, lerna.json, turbo.json, nx.json) | Reject | Reject |
| Repo > 500MB | Reject | Reject |
| No test framework | Skip coverage (v1.5 only), proceed with dep detection | Same |
| Private repo | Reject | Reject |

## 6. Code Analysis

### 6.1 AST Parsing [v1.0]

- `@typescript-eslint/parser` for TS/JS
- Build symbol table per file
- Cross-file reference index

### 6.2 Dependency Analysis [v1.0]

- Parse `package.json` → list deps
- npm registry: latest version, repo URL, deprecation status
- For outdated deps, kick off Signal A (v1.0) and Signal B in parallel (v1.5)

### 6.3 Signal A — Changelog Parsing [v1.0]

- Fetch GH releases for the dep's repo (prefer over scraping)
- Fallback to `CHANGELOG.md`
- LLM extracts breaking changes with `BreakingChangeSchema`:

```tsx
z.object({
  symbol: z.string(),
  changeType: z.enum(['removed', 'renamed', 'signature-changed', 'behavior-changed']),
  description: z.string().max(500),
  sourceUrl: z.string().url(),
})
```

### 6.4 Signal B — Semantic API Diffing [v1.5]

Three-tier pipeline:

1. **Primary**: download tarballs of old + new versions; extract `.d.ts` files; use TypeScript compiler API to walk declaration trees; build exported symbol set with full signatures; compute deterministic diff
2. **Fallback**: if no `.d.ts`, use `api-extractor` to generate from JS source + JSDoc
3. **Last resort**: AST-level diff of source files (catches removed exports but not behavioral changes)

Output schema:

```tsx
z.object({
  removedExports: z.array(z.string()),
  signatureChanges: z.array(z.object({ symbol: z.string(), before: z.string(), after: z.string() })),
  newDeprecations: z.array(z.string()),
  affectedSitesInRepo: z.array(z.object({ symbol: z.string(), files: z.array(z.string()) })),
  coveragePercent: z.number().min(0).max(100),
  unanalyzableSymbols: z.array(z.object({ symbol: z.string(), reason: z.string() })),
  analysisTier: z.enum(['dts', 'api-extractor', 'ast-only', 'griffe', 'apidiff', 'cargo-semver']),
})
```

The `analysisTier` field feeds directly into confidence calculation — `ast-only` deserves lower confidence than `dts`.

**[v2] Per-language semantic-diff strategy.** There is no universal API differ — each language uses its own mature, shell-invokable ecosystem tool, run inside that language's sandbox image. Each adapter **normalizes its tool's output into the schema above** (same shape; only `analysisTier` varies), so the confidence engine + UI stay language-agnostic.

| Language | API-diff tool (`analysisTier`) | Sandbox base | Notes |
| --- | --- | --- | --- |
| TypeScript | tsc compiler API (`dts`) / declaration-emit for JS+JSDoc (`api-extractor`) / AST (`ast-only`) | `node:20` | Existing v1.5 pipeline. |
| Python | **`griffe check`** (`griffe`) | `python:3.13-slim` | Real tool; detects API breaking changes between versions. Pip/poetry/uv. |
| Go | **`golang.org/x/exp/cmd/apidiff`** (`apidiff`) | `golang:1.x` | Real tool; API compatibility report. Go modules. |
| Rust | **`cargo-semver-checks`** / `cargo-public-api` (`cargo-semver`) | `rust:1.x-slim` | Real tools; semver-aware public-API diff. Cargo. |

The **changelog signal (Signal A) is already language-agnostic** (it fetches CHANGELOG/releases), so it is reused unchanged across languages. Analyzer fidelity differs per language → confidence ceilings are language-aware (§9.5).

## 7. Patch Generation

### 7.1 Strategy [v1.0]

- Full-file regeneration with style hints from repo
- Max 3 files per issue (token budget)
- Local diff computation (not LLM-generated)
- Atomic apply

### 7.2 Strategy [v1.5]

Hybrid:

- Files < 150 lines: full-file regeneration (existing v1.0 approach)
- Files 150–500: search-replace blocks
- Files > 500: hard-required search-replace blocks
- Robust block matching with fuzzy fallback (whitespace-normalized comparison) + retry
- Drops 3-file cap → cap by total tokens (100k); agent ranks affected files by impact (public-API-affecting first, then internal usages, then tests)

### 7.3 Style Preservation [v1.0]

- Detect repo's Prettier config
- Run `prettier --write` on changed files in sandbox
- No LLM-based style inference

### 7.4 Validation [v1.0]

- Post-patch AST parse confirms syntactic validity
- `tsc --noEmit` on changed + downstream files
- On failure: capture error, retry with error context, max 3 attempts

## 8. Sandbox / Test Execution

### 8.1 v1.0 — Docker Network Modes

**Phase A — Install**

- Container: `node:20-alpine` with pnpm
- `docker run --network=bridge` (full default network — yes, broader than ideal; v1.5 narrows this)
- Repo mounted (patches applied)
- Run install: auto-detect package manager
- 3-min timeout, 2GB mem cap, non-root user
- On success: snapshot `node_modules` to a named Docker volume
- Tear down Phase A container

**Phase B — Test**

- Same base image; mounts repo + node_modules snapshot
- `docker run --network=none` (zero egress, enforced by Docker daemon)
- Detect test command from package.json scripts
- Sequence: `tsc --noEmit` → `eslint .` → `vitest run` (or jest) → `pnpm run build` if defined
- 5-min timeout, 2GB mem cap, non-root user

**Tradeoff:** v1.0 Phase A allows full network egress during install. This is less restrictive than ideal — a malicious package could phone home. Mitigations: only scanning public OSS repos selected by user; running locally on user's own machine (not multi-tenant); Phase B has zero egress so nothing leaks during test execution. Acceptable for v1.0 portfolio scope; v1.5 hardens this.

### 8.2 v1.5 — Iptables-Level Network Allowlist

**Phase A** (replaces v1.0):

- iptables OUTPUT chain inside container:
    - default DROP
    - ACCEPT for tier-1 allowlist: `registry.npmjs.org`, `registry.yarnpkg.com`, `github.com` (port 443)
    - ACCEPT for tier-2 allowlist (per-scan opt-in only): `storage.googleapis.com`, `*.azureedge.net`, `binaries.prisma.sh`, `objects.githubusercontent.com`
- Resolves hostnames at container start; pins to IPs (with periodic refresh for long scans)
- If install fails due to network policy, capture which host was blocked, surface to user, suggest opt-in to tier-2 if it's a known binary registry

**Phase B**: unchanged from v1.0 (already `--network=none`)

### 8.3 v1.5 — node_modules Caching

- Cache key: `sha256(pnpm-lock.yaml + node version + OS + arch)`
- Stored in named Docker volume `mendel-node-modules-cache`
- On Phase A start: check cache; if hit, skip install (saves 60–120s per scan)
- Cache eviction: oldest entries when total cache > 5GB

### 8.4 Failure Modes

| Failure | Behavior |
| --- | --- |
| Phase A times out / install fails | No Phase B; surface install logs; **do not open PR** |
| Phase A blocked by network policy (v1.5) | Capture blocked host; offer tier-2 opt-in |
| Phase B fails | Surface failure logs per layer; agent triggers REPLAN (max 3 attempts) |
| Either phase OOM | Notify user; reject scan |

### 8.5 v2 — Phase C: Smoke-Test Execution [F20]

After Phase B passes, optionally **boot the project** in the sandbox to confirm it still comes up post-patch. Raises the verification ceiling above "tests pass" and is a **hard prerequisite for auto-merge (F24)**.

- Detect a boot command (heuristics: `scripts.start` / `scripts.dev` / `main`/`bin` entry / framework signature).
- Run it with a short timeout (default 90s, capped); watch stdout for a ready/listening signal or a crash; optionally curl `localhost:<port>/` or a detected `/health`.
- **`--network=none`** (same as Phase B — a booting app shouldn't need egress; if it does, that's reported honestly, not granted). Non-root, 2GB cap, mandatory teardown.
- `SmokeResult = { attempted, booted, signal, durationMs, logTail, reason }`. Honest by construction: `booted:false` with a reason (or `attempted:false` "no boot command found") is a valid, non-fatal outcome — never a fake green.
- **Confidence gate:** a failed smoke caps overall confidence like a failed verification does (extends §9.5's verification cap).
- **§11b.1 mandatory:** real-container test of both boot-success and boot-crash fixtures before trust (Docker hallucination has bitten us repeatedly).

### 8.6 v2 — `SandboxProvider` Interface (cloud-readiness seam)

All sandbox calls move behind `lib/sandbox/provider.ts`:

```tsx
interface SandboxProvider {
  runInstall(cfg): Promise<PhaseResult>;   // Phase A
  runTest(cfg): Promise<PhaseResult>;      // Phase B
  runSmoke(cfg): Promise<SmokeResult>;     // Phase C
  teardown(handle): Promise<void>;
}
```

The local implementation is today's Docker executor (extracted via behavior-snapshot, no drift). **v3 adds an E2B / Fly implementation behind the same interface** — the agent never changes. This is the single most important v3 hook.

### 8.7 v2 — Per-Language Sandbox Images + Cache Key

- Each language (§6.4 table) gets its own image, each following the **same two-phase + Phase C + iptables-allowlist + cache** model. Each new image gets a **real-container egress test** (§11b.1) before use, like the node image has.
- Cache key extends to `sha256(lockfile + language + image tag + node/runtime version + OS + arch)`; v2's LRU 5GB eviction (existing) applies per-image.

## 9. PR Submission

### 9.1 Branch Naming

`mendel/<type>/<slug>-<unix-timestamp>-<4char-hex-nonce>`

Example: `mendel/dep-upgrade/axios-1716045820-a3f9`

### 9.2 Pre-flight Deduplication [v1.0]

Before PR creation:

```
GET /repos/{owner}/{repo}/pulls?state=open&head={user}:mendel/<type>/<slug>
```

If open PR exists for same dep/issue, surface its URL; user chooses: "View existing PR" or "Force new PR" (overrides dedup).

### 9.3 Commit Message

Conventional Commits:

```
<type>: <description>

Co-authored-by: Mendel <mendel@bot.local>
```

### 9.4 PR Body Template

**v1.0:**

```
## What
[summary]

## Why
[impact]

## ⚠️ Confidence: medium — manual review required
This PR was generated by an autonomous agent using changelog parsing only.
Please review carefully before marking ready or merging.

## Evidence
- [citation 1]
- [citation 2]

## Changes
- [file-by-file]

## Verification Results
- ✅ TypeScript check
- ✅ Lint
- ✅ Tests (X/Y passing)
- ✅ Build

## ⚠ Not Analyzed
- [symbol or area]: [reason]

Analysis coverage: changelog-parsing-only. Semantic API diffing not yet
available in v1.0 — manually verify any behavioral assumptions.

---
*Generated by Mendel v1.0. Open as Draft — mark ready for review when you've validated.*
```

**v1.5** (replaces above):

```
## What / Why / [as above]

## Confidence: [SCORE] / 100 ([BUCKET])
- Signal A (changelog): [✓ / partial / ✗]
- Signal B (semantic diff): [✓ / partial / ✗ — analysis tier: dts/api-extractor/ast-only]
- Verification: [✓ all layers passed / ⚠ warnings]

## Evidence / Changes / Verification Results / [as above]

## ⚠ Not Analyzed
[explicit list]

Analysis coverage: X of Y exported symbols (Z%) inspected for breaking changes.

---
*Generated by Mendel v1.5. Confidence is calibrated estimate, not guarantee. Review the diff carefully.*
```

### 9.5 Confidence Calculation Engine [v1.5]

Input: Signal A output, Signal B output, patch metadata, verification results.

Output: `ConfidenceScore`.

```tsx
type ConfidenceScore = {
  overall: number; // 0-100
  bucket: 'high' | 'medium' | 'low';
  perBreakingChange: Array<{
    symbol: string;
    score: number;
    signalsAgreeing: ('changelog' | 'semantic_diff')[];
    tag?: string;
  }>;
  perPatchedFile: Array<{
    path: string;
    score: number;
    reductions: Array<{ reason: string; delta: number }>;
  }>;
  analysisCoverage: {
    symbolsAnalyzed: number;
    symbolsTotal: number;
    percentCovered: number;
    analysisTier: 'dts' | 'api-extractor' | 'ast-only';
    notAnalyzed: Array<{ symbol: string; reason: string }>;
  };
};
```

**Per-breaking-change scoring (asymmetric, refined per CTO Round-2):**

| Scenario | Score | Tag |
| --- | --- | --- |
| Both signals agree | 85–95 | — |
| AST/semantic catches it, changelog silent | **65–75** | "undocumented breaking change" |
| Changelog claims, AST doesn't confirm, good coverage (≥ 80%) | 40–55 | "needs manual verification" |
| Changelog claims, AST silent (low coverage / JS-only) | 55–65 | "incomplete analysis" |
| Only changelog available (Signal B not runnable) | 55–65 | "single-signal" |
| Heuristic match only | 30–45 | — |

**Per-patched-file adjustments:**

- Patch touches uncovered lines: -15
- Behavioral changes (vs. pure type changes): -10
- < 5 lines changed: +10

**Overall:** weighted average of per-item scores. Verification result acts as gate — failure caps overall at 50 (forces "low" bucket).

**Bucket thresholds:** ≥ 80 high; 60–79 medium; < 60 low.

**Threshold behavior:**

- Score ≥ user threshold (default 70) → standard PR
- 40 to threshold → Draft PR with warning
- < 40 → no auto-PR; surface diagnosis only

**[v2] Language-aware confidence ceilings.** Each analyzer's fidelity caps the reachable bucket. `analysisTier` maps to a max bucket (e.g., a `cargo-semver` public-API-only diff cannot alone reach `high`; tsc `dts` can). The cap is applied AFTER scoring and disclosed in "Not Analyzed." A weaker analyzer never produces an inflated bucket.

**[v2] Auto-merge eligibility [F24].** A pure function `evaluateAutoMerge(context) → { eligible, reasons[] }` that gates the new AUTOMERGE phase. Eligible ONLY if **all** hold (every NO reason is recorded — no silent skip):

1. Repo is opted into auto-merge (`RepoSetting.autoMergeEnabled`, default **false**) AND PAT has merge rights.
2. Change category ∈ allowlist: **patch/minor bump, no breaking change detected by *both* signals, signals agree.**
3. `overall` score ≥ high floor (default **90**, hard-clamped ≥ standard threshold).
4. Phase B (tests) passed **and** Phase C (smoke) booted.
5. No prior `RejectionPattern` for this dep/category.
6. Reversible: respects a cancelable dwell window before the merge lands.

Never eligible on: any detected breaking change, signal disagreement, failed/absent smoke, score below floor, or a dep with a rejection history. The engine **never relaxes the envelope or inflates its own score to qualify** (anti-gaming — mirrors §5b). Governed by **CLAUDE.md §5c (honesty-of-action floor)**.

## 10. Data Model (Prisma)

```
model Scan {
  id           String   @id @default(cuid())
  repoUrl      String
  startedAt    DateTime @default(now())
  completedAt  DateTime?
  status       String
  issuesFound  Int      @default(0)
  prsOpened    Int      @default(0)
  totalTokens  Int      @default(0)
  schemaVersion String  // "1.0" or "1.5" — for v1.0/v1.5 distinction
  issues       Issue[]
}

model Issue {
  id              String   @id @default(cuid())
  scanId          String
  scan            Scan     @relation(fields: [scanId], references: [id])
  type            String
  severity        String
  confidence      Json     // ConfidenceScore object (v1.5) or stub (v1.0)
  diagnosis       Json
  patch           Json?
  verification    Json?
  notAnalyzed     Json
  prUrl           String?
  status          String
  createdAt       DateTime @default(now())
}

model AgentLog {
  id         String   @id @default(cuid())
  scanId     String
  issueId    String?
  phase      String
  toolName   String?
  input      Json
  output     Json
  durationMs Int
  tokensUsed Int?
  createdAt  DateTime @default(now())
}

// v1.5
model RejectionPattern {
  id              String   @id @default(cuid())
  depName         String?
  changeType      String?
  rejectionReason String
  prUrl           String
  createdAt       DateTime @default(now())
  embedding       Bytes?   // semantic embedding for similarity lookup
}

// ── v2 additions ──
// All new models carry a nullable tenantId (unused locally; populated in v3 cloud — §15).

// [v2] Scan gains: language String?, workspaceKind String?  (both nullable)
// [v2] Issue gains: language String?, packageDir String?     (both nullable)

// [F21] one row per workspace member package scanned
model ScanPackage {
  id          String   @id @default(cuid())
  scanId      String
  name        String
  dir         String
  depsCount   Int      @default(0)
  issuesFound Int      @default(0)
  tenantId    String?
}

// [F22] "Point at any API" report (no repo, no PR)
model Inspection {
  id          String   @id @default(cuid())
  packageName String
  fromVersion String
  toVersion   String
  language    String?
  report      String   // JSON-stringified ApiReport
  createdAt   DateTime @default(now())
  tenantId    String?
}

// [F24] per-repo auto-merge opt-in (default OFF)
model RepoSetting {
  id               String   @id @default(cuid())
  repoUrl          String   @unique
  autoMergeEnabled Boolean  @default(false)
  autoMergeMaxBump String   @default("minor") // "patch" | "minor"
  tenantId         String?
}

// [F25] continuous-monitoring watchlist
model WatchlistEntry {
  id         String    @id @default(cuid())
  repoUrl    String
  schedule   String    // cron expression
  enabled    Boolean   @default(true)
  lastScanAt DateTime?
  nextScanAt DateTime?
  tenantId   String?
}

// [F25] local in-app notifications (autonomous activity feed)
model Notification {
  id        String   @id @default(cuid())
  kind      String   // "issue" | "pr-opened" | "auto-merged" | "scan-failed"
  body      String
  scanId    String?
  readAt    DateTime?
  createdAt DateTime @default(now())
  tenantId  String?
}

// [v2.0] revived from v1.0 (was defined-but-unused, removed in v1.0 Fix #14).
// Per-phase timing + tokens; auto-merge writes its full eligibility decision here.
model AgentLog {
  id         String   @id @default(cuid())
  scanId     String
  issueId    String?
  phase      String   // incl. "SMOKE", "AUTOMERGE"
  toolName   String?
  input      String   // JSON-stringified
  output     String   // JSON-stringified
  durationMs Int
  tokensUsed Int?
  createdAt  DateTime @default(now())
  tenantId   String?
}
```

## 11. Internal API Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/auth/github` | POST | Validate PAT, encrypt + store |
| `/api/scans` | POST | Start scan; returns scanId |
| `/api/scans/:id` | GET | Status + results |
| `/api/scans/:id/stream` | GET (SSE) | Live narration |
| `/api/issues/:id/fix` | POST | Generate fix |
| `/api/issues/:id/submit` | POST | Open PR (Draft in v1.0; respects threshold in v1.5) |
| `/api/issues/:id` | DELETE | Dismiss |
| `/api/dashboard` | GET | Aggregate stats |
| `/api/settings` | GET / PATCH | Settings CRUD |
| `/api/inspect`, `/api/inspect/:id` | POST / GET | [v2/F22] "Point at any API" report; no repo write (10/min) |
| `/api/watchlist`, `/api/watchlist/:id` | GET/POST/PATCH/DELETE | [v2/F25] continuous-monitoring watchlist CRUD |
| `/api/repos/settings` | PATCH | [v2/F24] per-repo auto-merge toggle (default OFF) |

All routes: Zod-validated, rate-limited (60/min general, 10/min on `/scans` POST + `/inspect`, 5/15min on `/auth`), session-cookie gated.

**[v2] Deliberately NOT HTTP:** the **eval harness (F19)** is CLI-only (`pnpm eval`) and the **MCP server (F26)** is a stdio process (`pnpm mcp`). Neither is web-exposed — avoids an unauthenticated heavy endpoint. MCP tool inputs are still Zod-validated as boundaries and carry all gating (confidence/draft/auto-merge); MCP responses never leak secrets. The **monitoring worker (F25)** reads the DB directly as a trusted local process (not via HTTP).

## 12. Security

Per Security-First Vibe Coding Rules:

- Secrets in `.env` only
- `.env`, `.env.local`, `.env.*.local`, `logs/`, `workspace/` in `.gitignore`
- Rate limiting on all API routes
- Zod validation at every boundary
- GitHub PATs encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY` ≥ 32 chars)
- Strict CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff
- File ops sandboxed to `./workspace`; path traversal prevented
- LLM input sanitized; per-scan 250k (v1.0) / 500k (v1.5) token hard cap
- **Sandbox** [v1.0]: containers run non-root; Phase B network=none; 5-min timeouts; 2GB caps
- **Sandbox** [v1.5]: + iptables-level allowlist on Phase A
- Generic errors to client; full traces in Pino
- Prisma-only DB access
- `pnpm audit` clean on every install

## 13. Observability

- Pino structured logs → `./logs/agent-<date>.jsonl`
- Per-phase timing + token usage in `AgentLog`
- Confidence calculations logged with full input/output (v1.5)
- v2: Sentry integration

## 14. Performance Targets

| Metric | v1.0 target | v1.5 target |
| --- | --- | --- |
| Time to first console line | < 2s | < 2s |
| Diagnosis per issue (LLM call) | < 10s | < 10s |
| Patch generation per file | < 20s | < 20s |
| Sandbox Phase A (install, cold) | < 3 min | < 3 min |
| Sandbox Phase A (cached, v1.5) | N/A | < 20s |
| Sandbox Phase B (test) | < 5 min | < 5 min |
| Total scan → PR for one issue | < 20 min | < 15 min |
| Concurrent scans per user | 1 (serial) | 1 (serial) |

## 15. Deployment

### v1.0 / v1.5 — Local Only

```bash
pnpm install
cp .env.example .env  # fill keys
pnpm db:migrate
docker compose build  # sandbox images
pnpm dev
```

Demo: local + Loom + real PR URLs.

### v2 — Local (post v1.5)

Still local — no cloud. v2 adds **out-of-process workers** alongside the Next.js app:

```bash
pnpm dev        # web app (as today)
pnpm monitor    # [F25] node-cron worker — continuous monitoring; shares runScan
pnpm mcp        # [F26] MCP stdio server — Mendel as a callable agent
pnpm eval       # [F19] eval bench (CLI; not a server)
pnpm test:docker  # real-container sandbox tests (per-language images, Phase C)
```

Per-language Docker images (`node:20`, `python:3.13-slim`, `golang:1.x`, `rust:1.x-slim`) built on first use. Workers and the sandbox sit behind interfaces (`SandboxProvider`, shared `runScan`) so v3 can host them unchanged. Demo: local + Loom + real PR URLs (now polyglot).

### v3 — Cloud Deployment (post v2)

- Hosted sandbox behind the v2 `SandboxProvider` interface (E2B, [Fly.io](http://Fly.io) machines, Cloudflare Containers)
- Vercel deploy
- Proper auth (NextAuth.js + GitHub OAuth, replacing PAT-session)
- Multi-tenant data model (the nullable `tenantId` columns added in v2 populate here)
- Hosted DB
- Hosted cron/queue for monitoring; HTTP/SSE MCP transport
- Sentry, distributed cache

## 16. Local Dev Setup

- Node 20+, pnpm 9+, Docker Desktop, Git
- GitHub PAT (`repo` + `read:user`)
- Gemini API key (free)
- 8GB RAM recommended (4GB min)
- `ENCRYPTION_KEY` (`openssl rand -base64 32`)

## 17. v1.0 → v1.5 → v2 Roadmap

| Concern | v1.0 | v1.5 | v2 (local) | v3 (cloud) |
| --- | --- | --- | --- | --- |
| Detection signals | Changelog only | Semantic diff (3-tier) | + **Smoke-test (Phase C)** [F20] | Historical regression |
| Confidence | "medium — review required" | Calibrated asymmetric scoring | + **Language-aware ceilings**; **eval-bench-proven** [F19] | Per-dep historical confidence |
| Patching | Full-file, max 3 files | Search-replace blocks, no cap | (unchanged) | — |
| Sandbox | Docker network modes | iptables allowlist | + **Phase C**, **`SandboxProvider` iface**, **per-language images** | Hosted (E2B / Fly) behind same iface |
| Caching | None | `node_modules` layered + LRU | per-image cache key | Distributed |
| PR mode | All Drafts | Threshold-gated | + **Auto-merge** (opt-in, §5c envelope) [F24] | — |
| Languages | TS-typed only | JS-only lower confidence | + **Python, Go, Rust** [F23] | — |
| Repos | Single-package | Single-package | + **Monorepos** [F21]; + **"any API" mode** [F22] | — |
| Test runners | Vitest only | Jest | + Mocha, AVA | — |
| Package managers | pnpm only | npm, yarn | + pip/poetry, go mod, cargo | — |
| Learning | None | Rejection patterns | (unchanged) | Per-repo, per-maintainer |
| Autonomy | None | None | + **Continuous monitoring** [F25]; + **MCP server** [F26] | Hosted cron/queue |
| Auth | PAT-session | PAT-session | PAT-session | NextAuth + GitHub OAuth |
| Tenancy | Single-user | Single-user | Single-user (nullable `tenantId` seeded) | Multi-tenant |