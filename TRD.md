# TRD — Mendel: Technical Requirements Document

> Technical Requirements Document | **Revision 3** | Last updated 2026-05-18

---

## 0. Revisions Log

**Rev 3 (2026-05-18)** — second CTO-review pass + capability honesty pass. Split v1 into v1.0 and v1.5.

- v1.0 sandbox: Docker network modes (`--network=bridge` Phase A, `--network=none` Phase B); iptables moves to v1.5
- v1.0 detection: changelog-only (Signal A); semantic API diffing (Signal B) moves to v1.5
- v1.0 confidence: single "medium — review required" label; calibrated asymmetric scoring moves to v1.5
- v1.0 patching: full-file regeneration, max 3 files; search-replace blocks move to v1.5
- v1.5 confidence: asymmetric scoring per CTO Round-2 — AST-detected/changelog-silent = 65–75
- v1.5 network: two-tier allowlist with per-scan opt-in for binary-fetching deps
- v1.5 caching: layered `node_modules` cache with `pnpm-lock + node + os` key

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
| Sandbox | Docker (Node 20 + pnpm), network modes | iptables rules (Alpine) |
| Style normalization | `prettier` | — |
| Semantic diffing | — | `typescript` compiler API + `api-extractor` |
| Logging | Pino | — |
| Testing | Vitest | — |
| Lint | ESLint + Prettier (+ Tailwind plugin) | — |
| Package manager | pnpm | npm, yarn detection |

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

### 4.2 Tool Schema

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

### 4.3 LLM Usage

Structured outputs only. Every LLM call uses Zod schemas; forces JSON.

**Retry on schema-validation failure:** retry up to 3 times with format-error feedback. After 3 failures, surface raw output to user.

**Token budgets (v1.0):**
- DIAGNOSE: 4k per issue
- PLAN: 8k
- PATCH: 8k per file, max 3 files → 24k per issue
- REPLAN: 12k × 3 = 36k
- Per-issue ceiling: 60k
- Per-scan ceiling: 250k

**Token budgets (v1.5):**
- Per-issue ceiling: 100k
- Per-scan ceiling: 500k

Model: Gemini 2.0 Flash. v1.5 optionally falls back to Gemini 2.5 Pro for low-confidence diagnoses.

## 5. v1 Scope Constraints

| Condition | v1.0 | v1.5 |
| --- | --- | --- |
| Non-TS/JS repo | Reject | Reject |
| No tsconfig.json (JS-only) | Reject | Accept with lower-confidence framing |
| Monorepo | Reject | Reject |
| Repo > 500MB | Reject | Reject |
| Private repo | Reject | Reject |

## 6. Code Analysis

### 6.1 AST Parsing [v1.0]

- `@typescript-eslint/parser` for TS/JS
- Build symbol table per file
- Cross-file reference index

### 6.2 Dependency Analysis [v1.0]

- Parse `package.json` → list deps
- npm registry: latest version, repo URL, deprecation status

### 6.3 Signal A — Changelog Parsing [v1.0]

- Fetch GH releases for dep's repo (prefer over scraping); fallback to `CHANGELOG.md`
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
1. **Primary**: download tarballs; extract `.d.ts`; TypeScript compiler API walks declaration trees; compute deterministic diff
2. **Fallback**: `api-extractor` if no `.d.ts`
3. **Last resort**: AST-level diff of source files

Output schema:

```tsx
z.object({
  removedExports: z.array(z.string()),
  signatureChanges: z.array(z.object({ symbol: z.string(), before: z.string(), after: z.string() })),
  newDeprecations: z.array(z.string()),
  affectedSitesInRepo: z.array(z.object({ symbol: z.string(), files: z.array(z.string()) })),
  coveragePercent: z.number().min(0).max(100),
  unanalyzableSymbols: z.array(z.object({ symbol: z.string(), reason: z.string() })),
  analysisTier: z.enum(['dts', 'api-extractor', 'ast-only']),
})
```

## 7. Patch Generation

### 7.1 v1.0 Strategy

- Full-file regeneration with style hints from repo
- Max 3 files per issue (token budget)
- Local diff computation; atomic apply

### 7.2 v1.5 Strategy

- Files < 150 lines: full-file regeneration
- Files 150–500: search-replace blocks
- Files > 500: hard-required search-replace blocks
- Fuzzy fallback + retry; drops 3-file cap → 100k token cap

### 7.3 Style Preservation [v1.0]

- Detect repo's Prettier config; run `prettier --write` on changed files in sandbox
- No LLM-based style inference

## 8. Sandbox / Test Execution

### 8.1 v1.0 — Docker Network Modes

**Phase A — Install**
- Container: `node:20-alpine` with pnpm
- `docker run --network=bridge` (full default network)
- 3-min timeout, 2GB mem cap, non-root user
- On success: snapshot `node_modules` to named Docker volume; tear down container

**Phase B — Test**
- Same base image; mounts repo + node_modules snapshot
- `docker run --network=none` (zero egress)
- Sequence: `tsc --noEmit` → `eslint .` → `vitest run` (or jest) → `pnpm run build` if defined
- 5-min timeout, 2GB mem cap, non-root user

**Tradeoff:** v1.0 Phase A allows full network egress during install. Mitigations: only public OSS repos; runs locally; Phase B has zero egress. Acceptable for v1.0; v1.5 hardens this.

### 8.2 v1.5 — Iptables-Level Network Allowlist

Phase A replaces v1.0 with iptables OUTPUT chain:
- Default DROP
- ACCEPT tier-1: `registry.npmjs.org`, `registry.yarnpkg.com`, `github.com` (port 443)
- ACCEPT tier-2 (per-scan opt-in): `storage.googleapis.com`, `*.azureedge.net`, `binaries.prisma.sh`, `objects.githubusercontent.com`

### 8.3 v1.5 — node_modules Caching

- Cache key: `sha256(pnpm-lock.yaml + node version + OS + arch)`
- Stored in named Docker volume `mendel-node-modules-cache`
- Cache eviction: oldest entries when total > 5GB

### 8.4 Failure Modes

| Failure | Behavior |
| --- | --- |
| Phase A times out / install fails | No Phase B; surface install logs; do not open PR |
| Phase A blocked by network policy (v1.5) | Capture blocked host; offer tier-2 opt-in |
| Phase B fails | Surface failure logs; agent triggers REPLAN (max 3 attempts) |
| Either phase OOM | Notify user; reject scan |

## 9. PR Submission

### 9.1 Branch Naming

`mendel/<type>/<slug>-<unix-timestamp>-<4char-hex-nonce>`

### 9.2 Pre-flight Deduplication [v1.0]

Query open PRs matching `mendel/<type>/<slug>` pattern. If found, surface URL; user chooses "View existing PR" or "Force new PR".

### 9.3 Commit Message

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

## Changes
- [file-by-file]

## Verification Results
- ✅ TypeScript check
- ✅ Lint
- ✅ Tests (X/Y passing)
- ✅ Build

## ⚠ Not Analyzed
- [symbol or area]: [reason]

Analysis coverage: changelog-parsing-only.

---
*Generated by Mendel v1.0. Open as Draft — mark ready for review when you've validated.*
```

### 9.5 Confidence Calculation Engine [v1.5]

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
  analysisCoverage: {
    symbolsAnalyzed: number;
    symbolsTotal: number;
    percentCovered: number;
    analysisTier: 'dts' | 'api-extractor' | 'ast-only';
    notAnalyzed: Array<{ symbol: string; reason: string }>;
  };
};
```

**Asymmetric scoring:**

| Scenario | Score | Tag |
| --- | --- | --- |
| Both signals agree | 85–95 | — |
| AST/semantic catches it, changelog silent | 65–75 | "undocumented breaking change" |
| Changelog claims, AST doesn't confirm, good coverage (≥ 80%) | 40–55 | "needs manual verification" |
| Changelog claims, AST silent (low coverage / JS-only) | 55–65 | "incomplete analysis" |
| Only changelog available | 55–65 | "single-signal" |
| Heuristic match only | 30–45 | — |

Per-file adjustments: -15 if uncovered lines touched, -10 if behavioral changes, +10 if < 5 lines.

Bucket thresholds: ≥ 80 high; 60–79 medium; < 60 low. Verification failure caps overall at 50.

## 10. Data Model (Prisma)

```prisma
model Scan {
  id            String    @id @default(cuid())
  repoUrl       String
  startedAt     DateTime  @default(now())
  completedAt   DateTime?
  status        String
  issuesFound   Int       @default(0)
  prsOpened     Int       @default(0)
  totalTokens   Int       @default(0)
  schemaVersion String
  issues        Issue[]
}

model Issue {
  id           String   @id @default(cuid())
  scanId       String
  scan         Scan     @relation(fields: [scanId], references: [id])
  type         String
  severity     String
  confidence   Json
  diagnosis    Json
  patch        Json?
  verification Json?
  notAnalyzed  Json
  prUrl        String?
  status       String
  createdAt    DateTime @default(now())
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
  embedding       Bytes?
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
| `/api/issues/:id/submit` | POST | Open PR |
| `/api/issues/:id` | DELETE | Dismiss |
| `/api/dashboard` | GET | Aggregate stats |
| `/api/settings` | GET / PATCH | Settings CRUD |

All routes: Zod-validated, rate-limited (60/min general, 10/min on `/scans` POST, 5/15min on `/auth`), session-cookie gated.

## 12. Security

- Secrets in `.env` only; never in client code
- `.env`, `logs/`, `workspace/` in `.gitignore`
- Rate limiting on all API routes
- Zod validation at every boundary
- GitHub PATs encrypted at rest (AES-256-GCM)
- Strict CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff
- File ops sandboxed to `./workspace`; path traversal prevented
- LLM input sanitized; per-scan token hard cap
- Sandbox containers non-root; Phase B network=none; timeouts; 2GB caps
- Generic errors to client; full traces in Pino
- Prisma-only DB access; `pnpm audit` clean

## 13. Performance Targets

| Metric | v1.0 target | v1.5 target |
| --- | --- | --- |
| Time to first console line | < 2s | < 2s |
| Diagnosis per issue | < 10s | < 10s |
| Patch generation per file | < 20s | < 20s |
| Sandbox Phase A (cold) | < 3 min | < 3 min |
| Sandbox Phase A (cached, v1.5) | N/A | < 20s |
| Sandbox Phase B | < 5 min | < 5 min |
| Total scan → PR (one issue) | < 20 min | < 15 min |

## 14. Deployment

### v1.0 / v1.5 — Local Only

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
docker compose build
pnpm dev
```

### v2 — Cloud (post v1.5)

Hosted sandbox (E2B / Fly.io), Vercel + Vercel KV, NextAuth.js + GitHub OAuth, multi-tenant data model.

## 15. Local Dev Setup

- Node 20+, pnpm 9+, Docker Desktop, Git
- GitHub PAT (`repo` + `read:user`)
- Gemini API key (free tier)
- 8GB RAM recommended
- `ENCRYPTION_KEY` (`openssl rand -base64 32`)

## 16. v1.0 → v1.5 → v2 Roadmap

| Concern | v1.0 | v1.5 | v2 |
| --- | --- | --- | --- |
| Detection signals | Changelog only | + Semantic diff (3-tier) | + Smoke test |
| Confidence | "medium — review required" | Calibrated asymmetric | Per-dep historical |
| Patching | Full-file, max 3 files | SR-blocks, no cap | — |
| Sandbox | Docker network modes | + iptables allowlist | Hosted (E2B / Fly) |
| Caching | None | node_modules layered | Distributed |
| PR mode | All Drafts | Threshold-gated | Auto-merge for very high conf |
| Languages | TS-typed only | + JS-only | + Python, Go, Rust |
| Repos | Single-package | Single-package | + Monorepos |
| Learning | None | Rejection patterns | Per-repo patterns |
