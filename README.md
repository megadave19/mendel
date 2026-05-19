# Mendel

Autonomous OSS maintenance agent. Detects stale dependencies with breaking changes, generates migration patches, runs verification in an isolated Docker sandbox, opens Draft PRs with calibrated confidence.

> **v1.0** — All PRs open as Drafts. Confidence: medium — manual review required.

---

## Requirements

- Node 20+
- pnpm 9+
- Docker Desktop
- Git

## Setup

```bash
# 1. Install dependencies (also sets up Husky pre-commit hook)
pnpm install

# 2. Create your env file
cp .env.example .env
# Edit .env: generate ENCRYPTION_KEY with `openssl rand -base64 32`

# 3. Push schema to SQLite database
pnpm db:push

# 4. Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Next.js dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript check (no emit) |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit tests |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm smoke` | Playwright E2E smoke tests |
| `pnpm db:push` | Push Prisma schema to DB (dev) |
| `pnpm db:migrate` | Run Prisma migrations (staging/prod) |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm format` | Prettier |

---

## Phases

- **v1.0** — Working demo: changelog detection, full-file patching, two-phase Docker sandbox, all PRs as Drafts
- **v1.5** — Calibrated confidence: semantic API diffing, asymmetric scoring, search-replace patching

See `PRD.md`, `TRD.md`, `CLAUDE.md`, and `STATE.md` for full context.
