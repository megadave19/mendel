# STATE.md — Mendel Project State

> Updated after each meaningful session. Read at session start.

---

## Current Phase: 1A — Project Skeleton

**Status:** In progress — skeleton written, awaiting user install + gate verification

---

## Completed

- Spec phase: PRD.md Rev 3, TRD.md Rev 3, CLAUDE.md Rev 3
- Phase 1A scaffolding:
  - `package.json` with full dep list (Next.js 15, Tailwind v4, Prisma, Zod, Framer Motion 11, GSAP 3, Three.js, octokit, Gemini, Pino, Vitest, Husky)
  - `tsconfig.json` strict mode, `@/` path alias
  - `next.config.ts`, `postcss.config.mjs` (Tailwind v4)
  - `app/globals.css` — all design tokens per CLAUDE.md §6
  - `app/layout.tsx` — Geist Sans + JetBrains Mono fonts
  - `app/(marketing)/page.tsx` — landing placeholder (S1)
  - `app/(app)/` — dashboard, settings, scan/[id] placeholders
  - `app/not-found.tsx`
  - `middleware.ts` — security headers (CSP, X-Frame-Options, etc.)
  - `instrumentation.ts` — env validation at server startup
  - `lib/env.ts` — Zod env validation
  - `lib/db/index.ts` — Prisma singleton
  - `prisma/schema.prisma` — full data model per TRD §10
  - `eslint.config.mjs`, `.prettierrc`, `vitest.config.ts`
  - `tests/env.test.ts` — 6 env schema tests
  - `.env.example`, `.gitignore`
  - Directory structure per CLAUDE.md §3

---

## Gate 1A Checklist

- [ ] `pnpm install` succeeds
- [ ] `.env` created from `.env.example` with valid values
- [ ] `pnpm db:push` succeeds (creates SQLite DB)
- [ ] `pnpm dev` boots without errors
- [ ] Design tokens visible in browser at localhost:3000
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm test` green (6 tests)

---

## Pending (Phase 1B — Hard Infra)

- Two-phase Docker sandbox (network=bridge / network=none)
- `@typescript-eslint/parser` AST wrapper — test on 3 real repos
- `octokit` integration — GitHub API, PAT validation, repo operations
- Gate 1B: end-to-end on `colinhacks/zod`, `pmndrs/zustand`, `tanstack/query`

## Not Started

- Phase 1C: Agent core (changelog, diagnosis, patch, SSE streaming, Draft PR)
- Phase 1D: UI polish (mascot, GSAP, 3D dep graph, Live Console)
- Phase 2A–2E: v1.5 features

---

## Open Questions

- None at this time.

---

## Phase Discipline Notes

- Nothing from Phase 1B+ has been touched.
- shadcn/ui init (`npx shadcn@latest init`) deferred — run before Phase 1D component work.
- Husky pre-commit hook created at `.husky/pre-commit` — runs after `pnpm install`.

---

## Last Updated

Phase 1A scaffolding complete — 2026-05-19
