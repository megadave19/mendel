# STATE.md — Mendel Project State

> Updated after each meaningful session. Read at session start.

---

## Current Phase: 1D — UI Polish

**Status:** Ready to start

---

## Completed

### Spec
- PRD.md Rev 3, TRD.md Rev 3, CLAUDE.md Rev 3

### Phase 1A — Project Skeleton ✅
- Full Next.js 15 scaffold with strict TypeScript
- Design tokens, security headers, env validation, Prisma schema
- Gate 1A: `pnpm typecheck && pnpm lint && pnpm test` green

### Phase 1B — Hard Infrastructure ✅ (Gate 1B: 14/14)
- **Docker sandbox** (`docker/sandbox.Dockerfile`) — node:22-alpine, pnpm@9 direct install (bypasses corepack), curl for egress verification
- **Two-phase executor** (`lib/sandbox/executor.ts`):
  - Phase A: `--network=bridge`, volume init for non-root write perms, `CI=true`, `--store-dir=/tmp/pnpm-store`
  - Phase B: `--network=none`, tsc + test, TYPECHECK_OK/FAIL markers
  - Egress verify fixed: single-quotes around sh -c to prevent outer shell `$?` expansion
- **Package manager detection** (`lib/sandbox/detect.ts`) — pnpm/yarn/npm, frozen install commands, vitest/jest test detection
- **GitHub integration** (`lib/github/`) — PAT validation, repo metadata, clone (--depth=1), monorepo detection, open PRs pagination, createDraftPR
  - Uses `@octokit/rest` (NOT the `octokit` umbrella — broken exports in Node 26)
  - `pnpm-workspace.yaml` only flagged as monorepo marker if it contains `packages:`
- **AST parser** (`lib/agent/signals/ast-parser.ts`) — @typescript-eslint/typescript-estree, two-pass import/usage indexer, buildReferenceIndex, findImportsFrom, findUsagesOf, findPackageUsageSites
- **Gate 1B script** (`scripts/gate-1b.ts`) — uses local fixture (tests/fixtures/simple-ts), clones zustand for AST test
- `.gitignore` updated: `.pnpm-store/` excluded (pnpm writes store into mounted fixture dir)

### Phase 1C — Agent Core ✅ (Gate 1C: 16/16)
- **LLM client** (`lib/llm/index.ts`) — Gemini 2.5-flash, schema retry (3x), transient error backoff (429/503, up to 8 retries), JSON fence stripping
- **Changelog parser** (`lib/agent/signals/changelog.ts`) — npm registry → GitHub repo URL → releases API → Gemini extracts breaking changes, always includes `sourceUrl`
- **Staleness detector** (`lib/agent/phases/detect.ts`) — compares installed vs npm latest, filters to major bumps or 3+ minor bumps, skips @types/ and workspace refs
- **Diagnosis engine** (`lib/agent/phases/diagnose.ts`) — Gemini structured output via Zod with `.transform()` truncation (not `.max()`) to handle verbose LLM output
- **Full-file patcher** (`lib/agent/patching/full-file.ts`) — deterministic package.json version bump + LLM rewrites source files + Prettier formatting
- **Draft PR submission** (`lib/agent/phases/submit.ts`) — deduplicated (checks existing open Mendel PRs), git branch + push + PR via Octokit, v1.0 confidence framing, "Not Analyzed" section
- **Agent runner** (`lib/agent/runner.ts`) — orchestrates 5 phases (DETECT→CHANGELOG→DIAGNOSE→PATCH→VERIFY→SUBMIT), SSE `EventEmitter` per scanId, 3-dep max, 250k token cap
- **API routes** (`app/api/scans/`) — POST start scan, GET list, GET [id] detail, GET [id]/stream SSE with heartbeat every 15s
- **SandboxConfig `frozenLockfile`** — `true` for known-good lockfiles (gate-1b fixture), `false` (default) post-patch so pnpm updates lockfile to match bumped version
- **Gate 1C script** (`scripts/gate-1c.ts`) — tests against `megadave19/mendel-test` (axios 0.24.0→1.16.1), uses `gh auth token` for git push (fine-grained PAT workaround), 16/16 checks pass
- **Real Draft PR** opened: https://github.com/megadave19/mendel-test/pull/1

---

## Gate Status

| Gate | Status | Notes |
|------|--------|-------|
| 1A | ✅ | typecheck, lint, test green |
| 1B | ✅ | 14/14 checks pass |
| 1C | ✅ | 16/16 checks pass, Draft PR live |
| 1D | pending | |

---

## Next: Phase 1D — UI Polish

Build all screens and interactions to Awwwards-tier cyberpunk CRT aesthetic:

1. **shadcn/ui init** — run `npx shadcn@latest init` before component work
2. **Landing page** — hero, mascot intro, "Connect GitHub" CTA
3. **PAT entry flow** — connect GitHub screen, scope validation feedback
4. **Repo picker** — search, paste URL, monorepo rejection message
5. **Live Console** — SSE stream rendered as terminal output, mascot animates through 9 states
6. **Scan detail** (`/scan/[id]`) — issue list, confidence badge (amber in v1.0), "Generate Fix" button
7. **Fix detail** — patch diff view, verification results, "Open Draft PR" action
8. **Dashboard** (`/dashboard`) — past scans table, status badges
9. **Settings** (`/settings`) — PAT management, encrypted at rest

**Design language:** JetBrains Mono headings, Geist body, dark only, lime/cyan/amber/red accents, scan-line overlay, GSAP page transitions, Framer Motion springs (stiffness 280, damping 28).

**Gate 1D checklist:**
- All buttons functional
- All 9 mascot states animated
- All 9 screens reachable
- `prefers-reduced-motion` respected
- Loom recorded (< 3 min)
- 3 real Draft PRs opened on real OSS repos
- Full user journey smoke test added

---

## Not Started

- Phase 2A–2E: v1.5 features (semantic diffing, calibrated confidence, iptables allowlist, SR-block patching, rejection learning)

---

## Tricky Areas (re-read CLAUDE.md §11b before touching)

- Docker sandbox: verified against simple-ts fixture + mendel-test repo ✅
- AST parser: verified against zustand (50 files, 3 parse errors, <20% rate) ✅
- GitHub API: rate-limit, auth, network, validation error wrapping ✅
- SSE streaming: heartbeat every 15s, force-dynamic, X-Accel-Buffering: no ✅

---

## Known Gotchas

- Node.js v26 on host — TypeScript pinned to 5.7.3 (5.9.x causes stack overflow with deep TSESTree types)
- Docker corepack issue: bypassed by `npm install -g pnpm@9.0.0` in Dockerfile
- Docker named volumes owned by root: `initVolumeOwnership()` runs a root container to chown before Phase A
- pnpm store written into mounted dir: fixed with `--store-dir=/tmp/pnpm-store`
- Outer shell `$?` expansion in execAsync: use single quotes around sh -c argument
- Fine-grained GitHub PATs don't return OAuth scopes and lack push scope — gate-1c uses `gh auth token` for push; `runner.ts` needs user to supply a classic PAT with `repo` scope
- Gemini 2.0-flash deprecated for new users — use `gemini-2.5-flash`
- LLM verbosity: use `.transform((s) => s.slice(0, N))` not `.max(N)` for string fields in Zod schemas that come from LLM output

---

## Phase Discipline Notes

- shadcn/ui init (`npx shadcn@latest init`) — run before Phase 1D component work
- Husky pre-commit: `pnpm typecheck && pnpm lint && pnpm test`
- All v1.5 features strictly off-limits until v1.0 ships

---

## Last Updated

Phase 1C complete, Gate 1C 16/16 — 2026-05-20
Draft PR live: https://github.com/megadave19/mendel-test/pull/1
