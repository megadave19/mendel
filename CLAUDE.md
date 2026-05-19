# CLAUDE.md — Working Rules for Mendel

> Source of truth for how Claude Code works on this project. Drop at project root. Read before every session.

> **Revision 3** — phased delivery split (v1.0 + v1.5), capability honesty pass.

---

## 0. Communication Style

Senior AI collaborator. Owner is a PM, not a developer. Vibe-coding entirely. Calibrate: don't dumb things down, but never leave them stuck.

### Defaults

- Lead with the answer. Solution first; context only if asked or non-obvious.
- Skip filler. No "Great question!", no "Sure thing!". Get to work.
- Copy-paste-ready outputs. No placeholders unless requested.
- When ambiguous, make a reasonable assumption, state it in one sentence, proceed.
- Flag real problems directly. Security, perf, architectural smells — say them plainly.
- Distinguish (a) established fact, (b) widely held practice, (c) inference, (d) genuine uncertainty.
- No agreement-for-friction-avoidance. If something is wrong, say so.

### Response Length

- Short factual queries: 1–3 sentences
- Code tasks: working output first
- Architecture decisions: full reasoning, show tradeoffs
- Long docs: headers only where navigation helps

## 1. Project Overview

**Mendel** is an autonomous AI agent that maintains public GitHub repositories. Detects stale dependencies with breaking changes, generates fixes with cited evidence, runs verification in an isolated sandbox, opens real PRs.

**Phased delivery:**

- **v1.0 (Working Demo)** — Changelog-only detection, full-file patching, Docker network-mode sandbox, all PRs open as Drafts with "medium confidence — review required" framing. 4 weekends.
- **v1.5 (Calibrated Confidence)** — Semantic API diffing, asymmetric confidence scoring, search-replace block patching, iptables network allowlist, rejection learning. +3–4 weekends after v1.0 ships.

Read **PRD.md** and **TRD.md** (project root) for full context.

## 2. Tech Stack — Locked

Do not propose alternatives without strong reason.

| Layer | v1.0 | v1.5 additions |
| --- | --- | --- |
| Framework | Next.js 15 (App Router, TS strict) | — |
| Styling | Tailwind v4 | — |
| UI base | shadcn/ui | — |
| Animation | Framer Motion 11 + GSAP 3 | — |
| 3D | Three.js + React Three Fiber | — |
| State | Zustand | — |
| DB | SQLite + Prisma | — |
| Validation | Zod | — |
| LLM | `@google/generative-ai` (Gemini 2.0 Flash) | — |
| GitHub | `octokit` | — |
| Sandbox | Docker (Node 20 + pnpm), `--network=bridge` / `--network=none` | iptables allowlist (Alpine) |
| Style normalization | `prettier` | — |
| Semantic diff | — | `typescript` compiler API + `api-extractor` |
| Tests | Vitest | — |
| Lint | ESLint + Prettier (+ Tailwind plugin) | — |
| Logging | Pino | — |
| Package manager | pnpm | npm, yarn detection |

## 3. File Structure

```
mendel/
├── app/
│   ├── (marketing)/
│   ├── (app)/
│   │   ├── scan/[id]/
│   │   ├── dashboard/
│   │   ├── settings/
│   │   └── layout.tsx
│   ├── api/
│   └── globals.css
├── components/
│   ├── ui/
│   ├── mascot/
│   ├── console/
│   ├── graph/
│   ├── confidence/
│   └── shared/
├── lib/
│   ├── agent/
│   │   ├── phases/
│   │   ├── tools/
│   │   ├── prompts/
│   │   ├── signals/
│   │   │   ├── changelog.ts
│   │   │   └── semantic-diff.ts
│   │   ├── confidence/
│   │   ├── patching/
│   │   │   ├── full-file.ts
│   │   │   └── search-replace.ts
│   │   └── runner.ts
│   ├── github/
│   ├── llm/
│   ├── sandbox/
│   │   ├── network-modes.ts
│   │   └── iptables-allowlist.ts
│   ├── db/
│   └── utils/
├── prisma/schema.prisma
├── workspace/
├── logs/
├── docker/
│   ├── sandbox-install.Dockerfile
│   └── sandbox-test.Dockerfile
├── public/
│   ├── mascot/
│   └── sounds/
├── tests/
├── .env.example
├── .gitignore
├── CLAUDE.md
├── PRD.md
├── TRD.md
├── STATE.md
├── README.md
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

## 4. Code Conventions

- TypeScript strict everywhere. No `any`. No `as` casts except at type-system boundaries (comment why).
- Zod at boundaries: every API route input, every LLM output, every external data parse.
- Server components by default. Mark client components with `'use client'`.
- Async/await over `.then()`.
- Named exports over default exports (except Next.js page files).
- Imports: external → `@/` → relative. Auto-sorted.
- No magic numbers. Hoist to named constants.
- Functions <= 50 lines. If longer, factor.
- One concept per file.
- Comments explain WHY, not WHAT.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`).
- Tag features in PR titles: `feat(v1.0): ...` or `feat(v1.5): ...`

## 5. Hard Rules — Security (Non-negotiable)

1. Secrets in `.env` only. Never log, never return in responses, never put in client code.
2. `.env`, `.env.local`, `.env.*.local`, `logs/`, `workspace/` in `.gitignore`.
3. Rate-limit every API route. `/api/scans` POST: 10/min. General: 60/min. Auth: 5/15 min.
4. Validate every input with Zod server-side.
5. GitHub PATs encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY` >= 32 chars).
6. CORS: explicit allowed origins. No wildcards.
7. Security headers via Next.js middleware (CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin). Remove X-Powered-By.
8. Errors to client: generic. Full stacks to Pino.
9. No dynamic code evaluation of any kind. No unsanitized HTML injection via React props. Ever.
10. LLM-specific:
    - Strip prompt-injection patterns from user input
    - Always set max output tokens
    - LLM API key server-side only
    - Validate LLM output via Zod; retry up to 3 times with format-error feedback
    - Token cap per scan: 250k (v1.0), 500k (v1.5)
11. Sandbox [v1.0]: Phase A `--network=bridge`, Phase B `--network=none`, non-root, timeouts, 2GB caps, ephemeral
12. Sandbox [v1.5]: + iptables OUTPUT chain on Phase A with tier-1/tier-2 allowlist
13. File operations: sandboxed to `./workspace` and `./logs`. Reject `..` or absolute paths escaping these.
14. No raw SQL. Prisma only.
15. `pnpm audit` clean on every install.

## 5b. Hard Rules — Confidence Framing (Non-negotiable)

**v1.0 rules:**

1. Every PR opens as **Draft** — user must mark ready.
2. Every PR description includes the **"Confidence: medium — manual review required"** banner.
3. Every PR includes the **"Not Analyzed"** disclosure.
4. Never assert a breaking change without changelog source URL cited.
5. UI shows confidence badge in amber on every issue. No green badges in v1.0.

**v1.5 rules:**

1. Every breaking-change detection carries a calibrated confidence score per TRD §9.5 asymmetric scoring table.
2. Every PR description includes numeric score + bucket + per-signal status.
3. Dual signals run in parallel. Disagreement surfaced as low-confidence, not papered over.
4. Analysis coverage reported: "Analyzed X of Y exported symbols (Z%)."
5. Threshold gating mandatory: >= threshold -> standard PR; 40 to threshold -> Draft; < 40 -> no auto-PR.
6. Verification failure caps overall confidence at 50 ("low" bucket).

If you find yourself looking for a way around any of these: stop, write STATE.md note, surface to owner.

## 6. UI/UX Rules — Design Language

### Aesthetic

Cyberpunk + oldschool CRT. Pixel-art mascot, scan-line overlays, terminal aesthetics elevated. Reference: Akash Malhotra's 3D portfolio. Awwwards-tier. Dark mode only.

### Design Tokens (`app/globals.css`)

```css
:root {
  --bg-0: #0A0A0A;
  --bg-1: #111111;
  --bg-2: #1A1A1A;
  --accent-primary: #C6FF3D;   /* lime — high conf (v1.5), success */
  --accent-secondary: #3DFFEE; /* cyan — links */
  --accent-warning: #FFB84D;   /* amber — medium conf, warnings, v1.0 default */
  --accent-danger: #FF4D5E;    /* red — low conf, errors */
  --text-primary: #F5F5F5;
  --text-secondary: #9A9A9A;
  --text-muted: #555555;
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-strong: rgba(255, 255, 255, 0.12);
  --glow-primary: 0 0 24px rgba(198, 255, 61, 0.4);
}
```

### Typography

- Headings: JetBrains Mono (700)
- Body: Geist Sans (400/500)
- Code: JetBrains Mono (400)
- `font-variant-numeric: tabular-nums` on numerics

### Motion Principles

1. Every state animated. No instant updates.
2. Spring easing (Framer Motion: stiffness 280, damping 28).
3. GSAP timelines for page transitions (horizontal shear + scan-line sweep).
4. Hover: scale 1.02 + glow.
5. Loading states narrate (mascot + agent text). No blank spinners.
6. Respect `prefers-reduced-motion: reduce`.

## 7. Testing & Verification Strategy

### 7.1 Testing Layers

| Layer | Tool | When |
| --- | --- | --- |
| TypeScript | `tsc --noEmit` | Every save / before commit |
| Lint | ESLint + Prettier | Every save / before commit |
| Unit tests | Vitest | After writing any `lib/` utility |
| Schema tests | Vitest + Zod | After defining any Zod schema |
| Integration tests | Vitest + fixtures | After each agent phase |
| E2E smoke | Playwright headless | After every feature; mandatory at gates |
| Manual click-through | Human | At every phase gate |

**Coverage targets:**
- `lib/` utilities: 70%
- Zod schemas: 100%
- E2E smoke: 3 critical flows (connect GitHub -> scan repo -> open Draft PR)

### 7.2 Definition of Working

Before declaring ANY feature done:

1. `pnpm typecheck` is clean
2. `pnpm lint` is clean (warnings OK, errors not)
3. New utility functions have tests; new Zod schemas have valid+invalid tests
4. Every button/link triggers the intended action when clicked
5. `pnpm smoke` passes
6. Claude describes verification steps; owner manually confirms
7. Logged in STATE.md

**Vibe-coded features are not done because Claude says they are. They're done when the owner has manually verified working behavior.**

### 7.3 Phase Integration Gates (mandatory, half-day each)

**Gate 1A:** App boots; env validates; design tokens visible; `pnpm typecheck && pnpm lint && pnpm test` green.

**Gate 1B:** Two-phase Docker sandbox runs on `colinhacks/zod` + `pmndrs/zustand`; Phase B `--network=none` verified to block egress; container teardown verified; AST parser tested on `tanstack/query`; GitHub auth smoke test added.

**Gate 1C:** Full scan on one fixture end-to-end; Draft PR created on GitHub; SSE verified to stream live (not buffered); REPLAN loop verified; scan flow smoke test added.

**Gate 1D:** All buttons functional; all 9 mascot states animated; all 9 screens reachable; reduce-motion respected; Loom recorded; 3 real Draft PRs opened; full user journey smoke test added.

### 7.4 Smoke Test Script (`pnpm smoke`)

Playwright headless against locally running app:

1. **Auth happy path**: landing -> "Connect GitHub" -> PAT entry -> repo picker
2. **Scan happy path**: repo picker -> paste fixture URL -> "Scan" -> Live Console renders -> >= 1 issue appears
3. **Fix happy path**: issues list -> "Generate Fix" -> fix detail view -> verification results -> "Open Draft PR" enabled

If `pnpm smoke` breaks: FIX IT before adding new features. Broken smoke tests are stop-the-line.

### 7.5 Pre-commit Hook

Husky pre-commit: `pnpm typecheck && pnpm lint && pnpm test`. Blocks commits if any fail.

### 7.6 The Single Most Important Rule

**If verification fails, stop. Fix it. Don't pile new features on top of broken old ones.**

```bash
# Before every commit:
pnpm typecheck && pnpm lint && pnpm test

# Before declaring a feature done:
pnpm smoke

# Before declaring a phase done:
pnpm typecheck && pnpm lint && pnpm test && pnpm smoke
# + the phase-specific gate checklist from §7.3
```

## 8. Deployment

### Local Development

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
docker compose build
pnpm dev
```

### Pre-merge Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] No new `any` types
- [ ] No new `console.log` (use Pino)
- [ ] No secrets in committed files
- [ ] `.env.example` updated if new env vars added
- [ ] PRD/TRD updated if behavior changed
- [ ] §5b confidence-framing rules audited if change touches agent logic or PR submission
- [ ] Feature tagged for correct phase (v1.0 vs v1.5)

**v1.0 / v1.5 are NOT deployed publicly. Local only. No Vercel config until v2.**

## 9. Definition of Done

### v1.0

- Landing page polished, matches design language
- User connects via PAT
- User scans a public TS-typed single-package repo
- Agent rejects monorepos with documented message
- Agent detects >= 1 stale dep with breaking changes via changelog parsing
- Two-phase Docker sandbox runs install + test
- Agent generates patch, runs Prettier, passes verification
- Agent opens a Draft PR with "medium confidence — review required" framing
- Live Console streams agent reasoning
- Dashboard shows past scans
- Mascot animates through 9 states
- >= 3 real Draft PRs on real OSS repos
- Loom recorded (< 3 minutes)
- Case study v1.0 written

### v1.5

All v1.0, plus: semantic API diffing, calibrated confidence scoring, SR-block patching, iptables allowlist, node_modules caching, rejection-learning loop, threshold-gated PR submission, "Uncertain" mascot state, color-calibrated confidence meters, confidence trends dashboard, >= 6 total PRs, updated Loom + case study.

## 10. Working Cadence

- **Maintain `STATE.md`** after each meaningful session: what's done, next, open questions. Read at session start.
- Destructive ops (`rm`, branch delete, DB reset): always confirm before executing.
- Tool call fails: diagnose first, suggest fix, don't retry blindly.
- Approaching context limits: summarize state to `STATE.md` before continuing.
- **Phase discipline**: if building a v1.5 feature during v1.0 work, stop and write a STATE.md note.

## 11. Forbidden Patterns

- Storing secrets in client code
- Disabling TypeScript strict mode
- Using `any` to silence errors
- String-concatenated SQL
- Dynamic code evaluation or unsanitized HTML injection
- Skipping sandbox verification
- **Opening non-Draft PRs in v1.0**
- **Claiming high confidence in v1.0**
- Submitting PRs without confidence framing and "Not Analyzed" section
- Inflating confidence scores to ship more PRs
- Supporting monorepos in v1.0 or v1.5
- Single-phase sandbox / disabling network mode enforcement
- LLM-based style preservation (Prettier only)
- Hardcoded API endpoints
- Inline styles beyond one-off Framer Motion props
- **Mixing v1.5 features into v1.0 work** without explicit phase-discipline justification

## 11b. Known Tricky Areas (Vibe-Coding Warnings)

### 11b.1 Docker Sandbox Orchestration

LLMs hallucinate Docker commands constantly. After writing any Docker integration code:

- Run against 2 fixture repos end-to-end before moving on
- Verify `--network=none` actually blocks egress: Phase B `curl https://example.com` must fail
- Verify container teardown: `docker ps -a` shows no leftover Mendel containers
- Verify timeout enforcement: deliberately hanging fixture must be killed at 5 min
- Verify memory cap: OOM kill at > 2GB

### 11b.2 AST Parsing with @typescript-eslint/parser

- Build AST wrapper as one of the first tasks in Phase 1B
- Pin `@typescript-eslint/parser` version explicitly
- Test against 3 real public TS repos before declaring done
- Write unit tests with real (not synthetic) code samples
- If a function returns no results, suspect API misuse before suspecting the test repo

### 11b.3 GitHub API Edge Cases

- Wrap all octokit calls in consistent error-handling: rate-limit, auth, network, validation, other
- Test rate-limit handling deliberately
- Test PAT scope validation on entry
- Test pagination on repos with > 100 open PRs
- Test fork detection and dedup query

### 11b.4 SSE Streaming (Agent -> Browser)

- Test before integrating with agent reasoning output
- Verify events stream live: test endpoint emitting 1 event/sec for 10s — client sees them one by one
- Verify reconnection handling
- Add heartbeat every 15s
- Maintain stream state in Zustand — don't rely on EventSource reconnect alone

### 11b.5 General Vibe-Coding Discipline

- For these 4 areas: write code, then verify against a real fixture before claiming done.
- When verification fails 3 times in a row: stop, write STATE.md note, don't keep retrying.

## 12. Kill Criteria

- **Weekend 5 and v1.0 not shipped** -> drop test coverage feature; reduce demo PRs to 2; ship something.
- **2+ hours on a single Docker/networking issue** -> simplify or defer to v1.5.
- **LLM output unreliable for a task type** (> 30% failure) -> fall back to safer alternative; document in STATE.md.
- **Repo type causes 3+ consecutive scan failures** -> reject that type in v1.0; document; move on.

The project's failure mode is *abandonment from frustration*, not *insufficient features*. Optimize for shipping.

## 13. When Stuck

If something isn't working after 3 attempts:

1. Stop. Don't dig deeper.
2. Write a short note in STATE.md: what was tried, what failed.
3. Surface to owner: (a) what was attempted, (b) hypothesis on why it failed, (c) 2 paths forward with tradeoffs.
4. Wait for direction.

## 14. Reference

- PRD: `/PRD.md`
- TRD: `/TRD.md`
- Confidence framing: §5b (re-read before any agent logic or PR submission work)
- Phase boundaries: §11 forbidden patterns + §12 kill criteria

---

## Revisions

**Rev 3 (2026-05-18)** — phased delivery split (v1.0 vs v1.5); capability honesty pass; added §5b v1.0 framing rules; added §12 Kill Criteria; tagged every feature for phase; updated forbidden patterns.

**Rev 2 (2026-05-18)** — added confidence rules, two-phase sandbox, semantic diffing, Prettier-based style, monorepo rejection.

**Rev 1 (2026-05-18)** — initial draft.

---

*Source of truth for this codebase. When something here conflicts with a one-off request, ask before deviating.*
