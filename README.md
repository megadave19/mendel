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

> **Heads-up:** don't run `pnpm build` while `pnpm dev` is up — they share `.next` and the build clobbers the dev server's vendor chunks (you'll see `Cannot find module ./vendor-chunks/...`). Fix: stop dev, `rm -rf .next`, restart.

---

## LLM provider

Mendel is provider-agnostic. Pick one via `LLM_PROVIDER` in `.env` (default `gemini`):

**Gemini (default)** — cheap (~5–15¢/scan paid tier), but free tier is small (~250–500 req/day, often exhausted by a single scan due to retries).

```bash
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
```

**GitHub Models (free fallback)** — OpenAI-compatible inference using a GitHub PAT with "models" access. Prototyping-grade rate limits, but no quota wall during dev.

```bash
LLM_PROVIDER=github-models
GITHUB_MODELS_TOKEN=$(gh auth token)   # or a PAT with models access
GITHUB_MODELS_MODEL=openai/gpt-4o-mini # default; publisher prefix required
```

Switching providers is a one-env-line change — the agent pipeline, prompts, and confidence framing are identical.

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
