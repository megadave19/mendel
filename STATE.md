# STATE.md — Mendel Project State

> Updated after each meaningful session. Read at session start.

---

## Current Phase: 1C — Agent Core

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

---

## Gate Status

| Gate | Status | Notes |
|------|--------|-------|
| 1A | ✅ | typecheck, lint, test green |
| 1B | ✅ | 14/14 checks pass |
| 1C | pending | |
| 1D | pending | |

---

## Next: Phase 1C — Agent Core

Build the full scan pipeline:

1. **Changelog parser** (`lib/agent/signals/changelog.ts`) — fetch CHANGELOG.md / GitHub releases, extract breaking-change mentions
2. **Dependency staleness detector** (`lib/agent/phases/detect.ts`) — compare installed vs latest, filter to deps with breaking changes
3. **Diagnosis engine** (`lib/agent/phases/diagnose.ts`) — Gemini 2.0 Flash, Zod-validated output, 3 retries, 250k token cap
4. **Full-file patcher** (`lib/agent/patching/full-file.ts`) — rewrite dependency version in package.json, run Prettier
5. **Agent runner** (`lib/agent/runner.ts`) — orchestrates phases, emits SSE events
6. **SSE API route** (`app/api/scans/[id]/stream/route.ts`) — streams agent reasoning live
7. **Draft PR submission** (`lib/agent/phases/submit.ts`) — uses createDraftPR, confidence framing per CLAUDE.md §5b
8. **Gate 1C** — full scan on fixture end-to-end, Draft PR created, SSE verified live

---

## Not Started

- Phase 1D: UI polish (mascot, GSAP, 3D dep graph, Live Console, all 9 screens)
- Phase 2A–2E: v1.5 features

---

## Tricky Areas (re-read CLAUDE.md §11b before touching)

- Docker sandbox: verify against 2 fixture repos before declaring done
- AST parser: verified against zustand (50 files, 3 parse errors, <20% rate) ✅
- GitHub API: rate-limit, auth, network, validation error wrapping ✅
- SSE streaming: test live delivery before integrating with agent

---

## Known Gotchas

- Node.js v26 on host — TypeScript pinned to 5.7.3 (5.9.x causes stack overflow with deep TSESTree types)
- Docker corepack issue: bypassed by `npm install -g pnpm@9.0.0` in Dockerfile (corepack ignores activated version, downloads latest)
- Docker named volumes owned by root: `initVolumeOwnership()` runs a root container to chown before Phase A
- pnpm store written into mounted dir: fixed with `--store-dir=/tmp/pnpm-store`
- Outer shell `$?` expansion in execAsync: use single quotes around sh -c argument

---

## Phase Discipline Notes

- shadcn/ui init (`npx shadcn@latest init`) deferred — run before Phase 1D component work
- Husky pre-commit: `pnpm typecheck && pnpm lint && pnpm test`
- All v1.5 features strictly off-limits until v1.0 ships

---

## Last Updated

Phase 1B complete, Gate 1B 14/14 — 2026-05-20
