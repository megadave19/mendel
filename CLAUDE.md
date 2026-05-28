# CLAUDE.md — Mendel

# [CLAUDE.md](http://CLAUDE.md) — Working Rules for Mendel

> Source of truth for how Claude Code works on this project. Drop at project root. Read before every session.
> 

> **Revision 2** — updated post-CTO-review. See "Revisions" at bottom.
> 

> **Revision 3** — phased delivery split (v1.0 + v1.5), capability honesty pass.
> 

> **Revision 4** — Phase D Design Iteration inserted; companion to [DESIGN.md](http://DESIGN.md).
> 

---

## 0. Communication Style

Senior AI collaborator. Owner is a PM, not a developer. Vibe-coding entirely. Calibrate: don't dumb things down, but never leave them stuck.

### Defaults

- Lead with the answer. Solution first; context only if asked or non-obvious.
- Skip filler. No "Great question!", no "Sure thing!". Get to work.
- Copy-paste-ready outputs. No placeholders unless requested.
- When ambiguous, make a reasonable assumption, state it in one sentence, proceed. Don't stack clarifying questions.
- Flag real problems directly. Security, perf, architectural smells — say them plainly. Direct > diplomatic.
- Distinguish (a) established fact, (b) widely held practice, (c) inference from context, (d) genuine uncertainty.
- No agreement-for-friction-avoidance. If something is wrong, say so.

### Response Length

- Short factual queries: 1–3 sentences
- Code tasks: working output first
- Architecture decisions: full reasoning, show tradeoffs
- Long docs: headers only where navigation helps

### What You Won't Do

- Explain how the owner should prompt you. Focus on the work.
- Excessive qualifiers when clarity matters
- Multiple clarifying questions in a row

### Memory

No persistent memory between sessions. Owner provides context. Don't speculate about previous conversations.

## 1. Project Overview

**Mendel** is an autonomous AI agent that maintains public GitHub repositories. Detects stale dependencies with breaking changes, generates fixes with cited evidence, runs verification in an isolated sandbox, opens real PRs.

**Phased delivery:**

- **v1.0 (Working Demo)** — SHIPPED 2026-05-20. Changelog-only detection, full-file patching, Docker network-mode sandbox, all PRs open as Drafts. Real Draft PRs landed on `megadave19/mendel-test` (axios + typescript). UI shipped but did not earn the PRD §13 aesthetic brief — three planned screens (S5/S6/S7) never built. See Phase D below.
- **Phase D (Design Iteration)** — CURRENT. Redesigns visual layer to match PRD §13 (cyberpunk-CRT) and builds S5/S6/S7 as inline states inside S4 + permalink routes. 2–3 weekends. Full scope in PRD §17b and [DESIGN.md](http://DESIGN.md).
- **v1.5 (Calibrated Confidence)** — PAUSED until Phase D Gate D4 passes. Semantic API diffing, asymmetric confidence scoring, search-replace block patching, iptables network allowlist, rejection learning, broader repo support. +3–4 weekends after Phase D.

Read [**PRD.md**](http://PRD.md) and [**TRD.md**](http://TRD.md) (project root, mirrored in Notion) for full context.

**One-line pitches:**

- v1.0: *"Dependabot version-bumps; Mendel ships a working migration patch as a starting point — explicit about needing your review."*
- v1.5: *"Dependabot tells you a dep is stale; Mendel ships the upgrade with breaking-change patches already applied, scored via dual independent signals, and honest about what it didn't analyze."*

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
| Sandbox | Docker (Node 20 + pnpm), `--network=bridge` / `--network=none` |   • iptables allowlist (Alpine) |
| Style normalization | `prettier` | — |
| Semantic diff | — | `typescript` compiler API + `api-extractor` |
| Tests | Vitest | — |
| Lint | ESLint + Prettier (+ Tailwind plugin) | — |
| Logging | Pino | — |
| Package manager | pnpm |   • npm, yarn detection |

Requirements: Node 20+, pnpm 9+, Docker Desktop, Git, `ENCRYPTION_KEY` ≥ 32 chars.

## 3. File Structure

```jsx
mendel/
├── app/                       # Next.js App Router
│   ├── (marketing)/           # landing
│   ├── (app)/                 # authenticated app
│   │   ├── scan/
│   │   │   ├── new/              # S3 New Scan (Phase D)
│   │   │   └── [id]/             # S4 Live Console — absorbs S5/S6/S7 inline (Phase D)
│   │   │       ├── issue/[id]/   # S6 permalink (Phase D)
│   │   │       └── pr/[id]/      # S7 permalink (Phase D)
│   │   ├── dashboard/
│   │   ├── settings/
│   │   └── layout.tsx
│   ├── api/                   # API routes
│   └── globals.css            # design tokens
├── components/
│   ├── ui/                    # shadcn primitives
│   ├── mascot/                # bot SVG + Framer variants
│   ├── console/               # live agent console
│   ├── graph/                 # 3D dep graph (R3F)
│   ├── confidence/            # meters, badges, breakdown (v1.5)
│   └── shared/
├── lib/
│   ├── agent/
│   │   ├── phases/            # scan, detect, diagnose, plan, patch, verify, [score v1.5], submit
│   │   ├── tools/             # one file per tool
│   │   ├── prompts/           # templates + Zod schemas
│   │   ├── signals/
│   │   │   ├── changelog.ts   # v1.0
│   │   │   └── semantic-diff.ts # v1.5
│   │   ├── confidence/        # scoring engine (v1.5)
│   │   ├── patching/
│   │   │   ├── full-file.ts   # v1.0
│   │   │   └── search-replace.ts # v1.5
│   │   └── runner.ts          # orchestrator
│   ├── github/                # octokit wrapper
│   ├── llm/                   # Gemini wrapper, retry, token tracking
│   ├── sandbox/
│   │   ├── network-modes.ts   # v1.0
│   │   └── iptables-allowlist.ts # v1.5
│   ├── db/                    # Prisma client, helpers
│   └── utils/
├── prisma/schema.prisma
├── workspace/                 # gitignored; cloned repos
├── logs/                      # gitignored; Pino output
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
├── STATE.md                   # session-state log
├── README.md
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

## 4. Code Conventions

- TypeScript strict everywhere. No `any`. No `as` casts except at type-system boundaries (comment why).
- Zod at boundaries. Every API route input, every LLM output, every external data parse.
- Server components by default. Mark client components with `'use client'`.
- Async/await over `.then()`.
- Named exports over default exports (except Next.js page files).
- Imports: external → `@/` → relative. Auto-sorted.
- No magic numbers. Hoist to named constants.
- Functions ≤ 50 lines. If longer, factor.
- One concept per file.
- Comments explain WHY, not WHAT.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`).
- **Tag features in PR titles**: `feat(v1.0): ...` or `feat(v1.5): ...`

## 5. Hard Rules — Security (Non-negotiable)

Per the project's Security-First Vibe Coding Rules:

1. Secrets in `.env` only. Never log, never return in responses, never put in client code.
2. `.env`, `.env.local`, `.env.*.local`, `logs/`, `workspace/` in `.gitignore`.
3. Rate-limit every API route. `/api/scans` POST: 10/min. General: 60/min. Auth: 5 / 15 min.
4. Validate every input with Zod server-side.
5. GitHub PATs encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY` ≥ 32 chars).
6. CORS: explicit allowed origins. No wildcards.
7. Security headers via Next.js middleware (CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin). Remove X-Powered-By.
8. Errors to client: generic. Full stacks to Pino.
9. No `eval()`, `new Function()`, `dangerouslySetInnerHTML`. Ever.
10. **LLM-specific:**
    - Strip prompt-injection patterns from user input
    - Always set max output tokens
    - LLM API key server-side only
    - Validate LLM output via Zod; retry up to 3 times with format-error feedback
    - Token cap per scan: 250k (v1.0), 500k (v1.5). Per issue: 60k (v1.0), 100k (v1.5).
11. **Sandbox** [v1.0]:
    - Phase A: `docker run --network=bridge`, non-root, 3-min timeout, 2GB cap
    - Phase B: `docker run --network=none`, non-root, 5-min timeout, 2GB cap
    - Ephemeral containers, torn down post-run
12. **Sandbox** [v1.5]: + iptables-level OUTPUT chain on Phase A with tier-1 default allowlist; tier-2 opt-in per scan
13. File operations: sandboxed to `./workspace` and `./logs`. Reject `..` or absolute paths escaping these.
14. No raw SQL. Prisma only.
15. `pnpm audit` clean on every install.

## 5b. Hard Rules — Confidence Framing (Non-negotiable)

The product's ethical floor is honest framing of what the agent knows.

**v1.0 rules** (single-signal, simpler):

1. Every PR opens as **Draft** — user must mark ready.
2. Every PR description includes the **"⚠️ Confidence: medium — manual review required"** banner. Never claim high confidence.
3. Every PR includes the **"Not Analyzed"** disclosure listing what wasn't or couldn't be checked.
4. Never assert a breaking change was caught without the changelog source URL cited.
5. UI shows confidence badge in amber on every issue. No green badges in v1.0.

**v1.5 rules** (dual-signal, calibrated):

1. Every breaking-change detection MUST carry a calibrated confidence score per the asymmetric scoring table in TRD §9.5.
2. Every PR description MUST include numeric score + bucket + per-signal status.
3. Dual signals run in parallel. Disagreement is surfaced as low-confidence, not papered over.
4. Analysis coverage MUST be reported: "Analyzed X of Y exported symbols (Z%)."
5. Threshold gating mandatory: ≥ user threshold → standard PR; 40 to threshold → Draft PR; < 40 → no auto-PR, surface diagnosis only.
6. Confidence calibration must be honest. Don't inflate to ship more PRs.
7. Verification failure caps overall confidence at 50 ("low" bucket).

If you find yourself looking for a way around any of these: stop, write `STATE.md` note, surface to owner.

## 6. UI/UX Rules — Design Language

(Full design ships in v1.0; v1.5 only adds calibrated color states for confidence.)

### Aesthetic

Cyberpunk + oldschool CRT. Pixel-art mascot, scan-line overlays, terminal aesthetics elevated. Reference bar: Akash Malhotra's 3D portfolio. Awwwards-tier. Dark mode only.

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
4. Hover micro-interactions: scale 1.02 + glow.
5. Loading states narrate (mascot + agent text). No blank spinners.
6. Respect `prefers-reduced-motion: reduce`.

### Confidence Visualization

- **v1.0**: All confidence badges amber ("medium — review required"). Reinforces single-signal limitation visually.
- **v1.5**: Color-coded meters (lime ≥ 80, amber 60–79, red < 60), signal-source pills ("changelog ✓", "semantic-diff ✓", "tests ✓"), "Not Analyzed" callout always visible.

### Mascot Rules

- Sprite sheet at `/public/mascot/sprites.svg`
- States in `components/mascot/states.ts` as Framer Motion variants
- Sync to current agent phase
- Mascot = favicon = OG image
- "Uncertain" state is v1.5-only

### Sound (toggleable, default OFF)

- Howler.js, toggle in localStorage
- UI clicks, ambient hum during operation, soft chime on PR open
- "Low-confidence warning" tone v1.5 only

### Skills to Use (Phase D-updated)

- **`frontend-design` skill** (Claude's built-in) — MUST be loaded before any UI work in Phase D. Read its [SKILL.md](http://SKILL.md) before scaffolding.
- **`/website-builder-setup` skill** (owner-installed) — available but **NOT for Mendel's primary components.** Its [21st.dev](http://21st.dev) component library and preset palettes will pull Mendel toward generic SaaS aesthetic — exactly what Phase D fixes. At most usable as structural-only starters that are then fully restyled against [DESIGN.md](http://DESIGN.md).

**Source of truth for visual decisions: [DESIGN.md](http://DESIGN.md)** (sibling document, mirrored in Notion). Read [DESIGN.md](http://DESIGN.md) §0–§10 at the start of every UI-touching session. Token values in this section's "Design Tokens" subsection are mirrored from [DESIGN.md](http://DESIGN.md) §5; if they ever diverge, [DESIGN.md](http://DESIGN.md) wins.

Inspiration: see [DESIGN.md](http://DESIGN.md) §4 Design Pillars (Teenage Engineering, 90s cyberpunk analog, Nixtio dashboard density, The Ratio terminal chrome). Awwwards browsing is fine for ambient inspiration but [DESIGN.md](http://DESIGN.md) is the working brief.

## 6b. Hard Rules — Phase D Design Iteration (Non-negotiable)

Phase D fixes the gap between v1.0's PRD-specified aesthetic ("Awwwards-tier cyberpunk + CRT") and what shipped (generic dark-mode SaaS). These rules prevent regression.

**Mandatory workflow for every UI task in Phase D:**

1. Load the `frontend-design` skill.
2. Read [DESIGN.md](http://DESIGN.md) §0–§10 (universal sections) at session start.
3. Read the relevant per-screen brief ([DESIGN.md](http://DESIGN.md) §11).
4. Read the relevant component spec ([DESIGN.md](http://DESIGN.md) §12), or create one as part of the work.
5. Build the component in isolation at `/dev/[component]` before integrating.
6. Manual PM walk-through before declaring done (§7.2).
7. If any new design decision was made during build, update [DESIGN.md](http://DESIGN.md) before closing the task.

**Phase D screen architecture (revised):** S5/S6/S7 are no longer separate screens. They are inline states inside S4 (Live Console) + permalink routes that reuse the same components. See [DESIGN.md](http://DESIGN.md) §10. **9 screens → 6 screens** on **5 primary routes + 2 permalink sub-routes** (`/scan/[id]/issue/[id]`, `/scan/[id]/pr/[id]`) for case-study shareable URLs. Total = 7 routes.

**Phase D sub-phases (per PRD §17b):** D1 doc + mascot → D2 S1 + S4 (motion-heavy) → D3 S5/S6/S7 inline + permalink → D4 rest-mode screens. Half-day gate per §7.3 at the end of each.

**v1.5 work is paused.** No semantic diffing, no asymmetric scoring, no search-replace blocks, no allowlist tier-2 until Phase D Gate D4 passes. If v1.5 code creeps in, stop and write a `STATE.md` note.

**Anti-patterns that produced v1.0 AI-slop — do NOT repeat:**

- Rest-mode screens 80%+ empty black space (current Settings, New Scan, Live Console). Nixtio-density is the bar.
- Same H1+subtitle template across screens. Each mode (boot/running/rest) has its own header treatment.
- Mascot duplicated 2–3 times per screen with no behavioral difference. One mascot per screen unless S1.
- Mascot speaking, captioning, or explaining. Reactions only, no chatbot tone.
- Dropping the cyberpunk-CRT brief at execution time. ScanlineOverlay is page-level. ASCII dividers used. Glow is semantic, not decorative.
- Generic [21st.dev](http://21st.dev) / preset components used as-is. Build custom against [DESIGN.md](http://DESIGN.md).
- **Dead controls** (buttons / links / command-bar keys without working handlers). Wire it, remove it, or render visibly-disabled with `title="coming soon"`. (Added 2026-05-26 — §7.2a.)
- **Decorative-only data viz on primary screens** (graphs/charts/lists with no real data and no interaction). Wire to real data + add a meaningful interaction, or remove the component. (Added 2026-05-26 — §7.2a.)
- **Declaring done on typecheck/lint/tests alone** without the §7.2 step 6 spec-conformance audit (per-screen brief ↔ live screenshot, met/missed list). (Added 2026-05-26 — §7.2a.)

If you find yourself looking for a way around any of these: stop, write `STATE.md` note, surface to owner.

## 7. Testing & Verification Strategy

This is a vibe-coded project. The single biggest risk is plausible-looking code that doesn't actually work — hallucinated API calls, miswired buttons, components that exist but aren't reachable. The testing strategy is built explicitly for this failure mode.

### 7.1 Testing Layers (full v1.0)

| Layer | Tool | When | What it catches |
| --- | --- | --- | --- |
| **TypeScript** | `tsc --noEmit` | Every save / before every commit | Type errors, hallucinated APIs that don't match signatures |
| **Lint** | ESLint + Prettier | Every save / before every commit | Style drift, common bug patterns |
| **Unit tests** | Vitest, colocated `*.test.ts` | After writing any `lib/` utility | Function-level correctness |
| **Schema tests** | Vitest with Zod | After defining any Zod schema | Valid + invalid input handling |
| **Integration tests** | Vitest with fixtures | After each agent phase | Phase-level correctness with real fixture data |
| **E2E smoke tests** | Playwright headless | After every feature; mandatory at phase gates | Wired-up flows, button-to-action paths, UI regressions |
| **Manual click-through** | Human (you) | At every phase gate | Visual polish, animation correctness, UX feel |

**Coverage targets:**

- `lib/` (utilities, agent logic): 70%
- Zod schemas: 100% (cheap to test, high value)
- E2E smoke: 3 critical user flows covered (connect GitHub → scan repo → open Draft PR)
- UI components: exempt from unit testing; covered by E2E smoke + manual click-through

### 7.2 Definition of Working (per-feature)

Before declaring ANY feature done, the following checklist must pass. If it doesn't, the feature isn't done.

1. **Compiles**: `pnpm typecheck` is clean
2. **Lints**: `pnpm lint` is clean (warnings OK, errors not)
3. **Unit-tested**: new utility functions have tests; new Zod schemas have valid+invalid tests
4. **Wired**: if the feature has a UI surface, every button/link triggers the intended action when clicked. No dead controls. (See §7.2a.)
5. **No decorative-only data components**: any UI element that represents data (graph, chart, list, map) on a primary screen must be wired to real data AND have at least one meaningful interaction. Pure decoration is reserved for marketing surfaces. (See §7.2a.)
6. **Visual self-audit against the spec brief**: open DESIGN.md §11 to the per-screen brief. List every requirement as a checkbox. Screenshot the live screen. For each checkbox mark **met / partial / missed / violated**. Any miss → not done; fix before continuing. (See §7.2a — this is the step that has historically been skipped.)
7. **Smoke-tested**: `pnpm smoke` passes (Playwright E2E for the critical flows)
8. **Manually verified**: I (Claude) describe the verification steps in the chat. The owner manually walks through them and confirms.
9. **Logged in [STATE.md](http://STATE.md)**: feature name, what was built, how it was verified, AND the spec-conformance audit result (which boxes met/missed).

This last point is critical: **vibe-coded features are not done because Claude says they are. They're done when the owner has manually verified the working behavior.** This isn't burdensome — the manual walk-through is usually 2-5 minutes per feature.

### 7.2a. Hard rules added 2026-05-26 — root-cause fixes for shipped-but-broken features

The pattern: detailed spec → I built something matching the description → declared done on typecheck/lint/tests → owner found dead buttons, decorative-only data viz, and silent spec violations on screen. These rules block that path.

**Dead-control rule (§7.2 step 4):** every interactive element in shipped code MUST have a working handler. If a feature is planned-not-built, do NOT render the control. `onClick={() => {}}`, missing `onPress`, and `href="#"` placeholders are forbidden. The acceptable patterns are: (a) wire it for real, (b) remove the control entirely, (c) render `aria-disabled='true'` with a `title="coming soon"` tooltip and visibly muted styling.

**Decorative-data rule (§7.2 step 5):** if a component visually represents the user's data (a graph of their deps, a chart of their issues, a map of their scans), it MUST be backed by real data and offer at least one meaningful interaction (hover tooltip, click-to-act, filter, drill-down). Pure WebGL eye-candy with no semantic load belongs in marketing surfaces only, never on `/scan/[id]`, `/dashboard`, etc.

**Spec-conformance audit (§7.2 step 6):** every per-screen build ends with a side-by-side: per-screen brief in DESIGN.md §11 ↔ live screenshot. Output a checklist with met/missed for each requirement before declaring done. Skipping this is what caused the S4 audit findings of 2026-05-26.

**Spec-deviation protocol:** BEFORE deviating from any spec requirement (DESIGN.md, PRD, TRD, CLAUDE.md) — STOP. Write a STATE.md note describing (a) the spec requirement, (b) why I'm proposing to deviate, (c) two paths (comply vs deviate) with trade-offs. Surface to owner. Wait for direction. **Never deviate silently.** Examples of past silent deviations: stripping the owner-supplied mascot textures to lerp emissive color, inventing procedural FX choreography, shipping a decorative dep graph in place of a functional one.

### 7.3 Phase Integration Gates (mandatory, half-day each)

At the end of every phase, dedicate a half-day to integration testing. No new phase work starts until the gate passes. This is borrowed from the dev review's recommendation for Phase 1B and applied to all phases.

**Phase 1A Gate** (after Project Skeleton):

- App boots locally with `pnpm dev`
- All env vars validate on startup (no silent failures)
- Landing page renders with design tokens visible
- Tailwind + Framer Motion + GSAP all load without console errors
- Prisma migrations run cleanly
- Run `pnpm typecheck && pnpm lint && pnpm test` — all green

**Phase 1B Gate** (after Hard Infra: Sandbox + AST + GitHub):

- Two-phase Docker sandbox runs end-to-end on 2 fixture repos: `colinhacks/zod` and `pmndrs/zustand`. Phase A installs deps; Phase B runs tests.
- Verify Phase B `--network=none` actually blocks egress (curl from container fails)
- Verify container teardown (no leftover `docker ps -a` entries after a scan)
- AST wrapper parses a 3rd fixture repo (`tanstack/query`); `findReferences` returns expected results on a known symbol
- GitHub integration: clone a public repo, list open PRs, query for dedup pattern, fork into your account, delete the fork as cleanup — all work
- Smoke test added for: "connect GitHub via PAT" flow

**Phase 1C Gate** (after Agent Core):

- Run a full scan on one fixture repo end-to-end: detect → diagnose → patch → verify → submit Draft PR
- Verify the Draft PR was actually created (check on GitHub)
- Verify SSE stream actually streams (not buffered) by watching the console during scan
- Verify REPLAN loop fires when a fixture is constructed to fail verification
- Smoke test added for: "scan repo → see issues populate → click Generate Fix"

**Phase 1D Gate** (after UI Polish + Demo):

- Click-through every button/link in the app; verify all are functional
- Mascot animates through all 9 states (manually trigger each via dev console or fixture)
- All 9 screens reachable from at least one path; no orphan routes
- Reduce-motion preference respected on any animation-heavy screen
- Loom recording shipped
- 3 real Draft PRs opened on real public repos and merged into demo dashboard
- Smoke test added for: "full user journey from landing → scan → PR"

### 7.4 Smoke Test Script (`pnpm smoke`)

A single command runs Playwright headless against the locally running app. Tests cover:

1. **Auth happy path**: landing → click "Connect GitHub" → enter PAT → land on repo picker
2. **Scan happy path**: repo picker → paste fixture URL → click "Scan" → Live Console renders → at least one issue appears in issues list
3. **Fix happy path**: issues list → click "Generate Fix" → fix detail view appears → verification results render → "Open Draft PR" button is enabled

Each test runs against a fixture repo (mocked GitHub responses where appropriate to avoid hitting rate limits in CI).

**Failure mode:** if `pnpm smoke` breaks during development, FIX IT before adding new features. Broken smoke tests are a stop-the-line condition.

### 7.5 Visual Regression (Phase 1D specifically)

For the design-heavy work in 1D, commit screenshots of key screens. Playwright compares on every run. If a screen changes visually without explicit intent, the test fails and we investigate.

Screens to snapshot:

- Landing (S1)
- Live Console at the "thinking" state (S4)
- Issues list with sample issues (S5)
- Fix detail view (S6)
- Dashboard (S8)

### 7.6 Pre-commit Hook (recommended)

A simple Husky pre-commit hook runs `pnpm typecheck && pnpm lint && pnpm test` automatically. Blocks commits if any fail. Setup is a one-time 5-minute task; saves you from committing broken code.

### 7.7 What NOT to Test in v1.0

To keep scope reasonable:

- No load testing (single-user local app)
- No security penetration testing (covered by the security rules; can audit in v2 if going cloud)
- No accessibility deep-dive (basic a11y from shadcn/ui is sufficient for v1.0)
- No multi-browser testing (Chromium-only via Playwright is fine for v1.0)
- No cross-platform Docker testing beyond your own machine (document any quirks; don't block on Windows-specific edges)

### 7.8 The Single Most Important Rule

**If verification fails, stop. Fix it. Don't pile new features on top of broken old ones.** The failure mode for vibe-coded projects is "works in isolation, breaks in integration." Phase gates exist specifically to catch this before it compounds.

Run before every commit:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Run before declaring a feature done:

```bash
pnpm smoke
```

Run before declaring a phase done:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm smoke
# + the phase-specific gate checklist from §7.3
```

## 8. Deployment Procedures

### Local Development

```bash
pnpm install
cp .env.example .env  # fill keys
pnpm db:migrate
docker compose build
pnpm dev
```

### Pre-merge Checklist (every PR Claude opens for THIS codebase)

- [ ]  `pnpm typecheck` passes
- [ ]  `pnpm lint` passes
- [ ]  `pnpm test` passes
- [ ]  No new `any` types
- [ ]  No new `console.log` (use Pino)
- [ ]  No secrets in committed files
- [ ]  `.env.example` updated if new env vars added
- [ ]  PRD/TRD updated if behavior changed
- [ ]  §5b confidence-framing rules audited if change touches agent logic or PR submission
- [ ]  Feature tagged for correct phase (v1.0 vs v1.5)

### v1.0 / v1.5 Are NOT Deployed Publicly

Both run locally only. Do not write Vercel deployment config until v2.

## 9. Definition of Done

### v1.0 — Working Demo (4 weekends)

- Landing page polished, matches design language
- User connects via PAT
- User scans a public TS-typed single-package repo
- Agent rejects monorepos with the documented message
- Agent detects ≥ 1 stale dep with breaking changes via changelog parsing on a fixture repo
- Two-phase Docker sandbox (`--network=bridge` Phase A, `--network=none` Phase B) runs install + test
- Agent generates a patch (full-file), runs Prettier, passes verification
- Agent opens a **Draft PR** on a real public repo with "medium confidence — review required" framing
- Live Console streams agent reasoning
- Dashboard shows past scans
- Mascot animates through 9 states
- ≥ 3 real Draft PRs opened on real OSS repos
- Loom recorded (< 3 minutes)
- Case study v1.0 written (problem → architecture → v1.0 limitations → v1.5 roadmap)

### Phase D — Design Iteration (2–3 weekends)

- [DESIGN.md](http://DESIGN.md) complete and reviewed by owner
- Mascot designed in chosen tool (Rive 2D or low-poly R3F per [DESIGN.md](http://DESIGN.md) §15 Q2) with idle + 5 core animation states minimum
- All 6 routes redesigned and rebuilt per [DESIGN.md](http://DESIGN.md) per-screen briefs
- S5/S6/S7 functional inline in S4 + reachable via permalink routes (`/scan/[id]/issue/[id]`, `/scan/[id]/pr/[id]`)
- All 14 components from [DESIGN.md](http://DESIGN.md) §12 inventory exist and pass `/dev/[component]` review
- [DESIGN.md](http://DESIGN.md) §13 anti-references list manually audited; every item confirmed absent in the live app
- Visual regression snapshots committed for all 6 routes
- Loom re-recorded with new design (replaces v1.0 Loom)
- Case study updated to cover the redesign + hybrid screen architecture

### v1.5 — Calibrated Confidence (+3–4 weekends)

All v1.0, plus:

- Semantic API diffing (3-tier: .d.ts → api-extractor → AST)
- Calibrated confidence scoring with asymmetric math
- Search-replace block patching for files > 150 lines, no file cap
- Iptables allowlist on Phase A with tier-1 default + tier-2 opt-in
- `node_modules` layered caching
- Rejection-learning loop
- Threshold-gated PR submission (Draft vs. standard)
- "Uncertain" mascot state
- Color-calibrated confidence meters across UI
- Dashboard adds confidence trends + regression rate
- ≥ 3 additional PRs on harder repos (≥ 6 total)
- Updated Loom + case study covering the calibration story

## 10. Working Cadence

- Long sessions normal. Use context efficiently.
- **Maintain `STATE.md`** at project root after each meaningful session: what's done, next, open questions. Read at session start.
- Destructive ops (`rm`, branch delete, DB reset): always confirm before executing.
- Tool call fails: diagnose first, suggest fix, don't retry blindly.
- Approaching context limits: summarize state to `STATE.md` before continuing.
- **Phase discipline**: if you find yourself building a v1.5 feature during v1.0 work, stop and write a note in `STATE.md`. Don't sneak v1.5 in.

## 11. Forbidden Patterns

Reject these even if asked:

- Storing secrets in client code
- Disabling TypeScript strict mode
- Using `any` to silence errors
- String-concatenated SQL
- `dangerouslySetInnerHTML` with unsanitized content
- Skipping sandbox verification "just this once"
- **Opening non-Draft PRs in v1.0** (must be Draft)
- **Claiming high confidence in v1.0** (single signal — always "medium — review required")
- Submitting PRs without confidence framing and "Not Analyzed" section
- Generating PRs from a single signal in v1.5 without surfacing as lower-confidence
- Inflating confidence scores to ship more PRs
- Supporting monorepos in v1.0 or v1.5 (v2 only)
- Single-phase sandbox / disabling network mode enforcement
- LLM-based style preservation (Prettier only)
- Hardcoded API endpoints (always env-configurable)
- Inline styles beyond one-off Framer Motion props
- **Mixing v1.5 features into v1.0 or Phase D work** without an explicit phase-discipline justification

**Phase D additions (Rev 4):**

- Using the `/website-builder-setup` skill's [21st.dev](http://21st.dev) components or preset palettes for Mendel's primary UI
- Shipping rest-mode screens that are 80%+ empty black space (Nixtio-density is the bar)
- Reusing the same H1+subtitle template across screens (each mode has its own header treatment)
- Duplicating the mascot 2–3 times per screen with no behavioral difference (one mascot per screen unless S1)
- Letting the mascot speak, caption, or explain (reactions only — never chatbot tone)
- Skipping the `frontend-design` skill load or [DESIGN.md](http://DESIGN.md) read at the start of a UI session

## 11b. Known Tricky Areas (Vibe-Coding Warnings)

Dev review flagged four areas where LLMs commonly hallucinate plausible-looking but broken code. These need explicit care: write the code, then *manually verify against a real fixture* before declaring done. Don't trust that it works because it looks right.

### 11b.1 Docker Sandbox Orchestration

**The trap:** LLMs hallucinate Docker commands constantly. Plausible-looking `docker run` flags, volume mount syntax, network mode names, exit-code parsing logic — all of these can be subtly wrong in ways that compile fine but fail at runtime.

**Verification protocol:**

- After writing any Docker integration code, run it against 2 fixture repos end-to-end (Phase A install + Phase B test) before moving on
- Verify `--network=none` actually blocks egress: have Phase B try `curl https://example.com` and confirm it fails
- Verify container teardown actually happens: `docker ps -a` should show no leftover Mendel containers after a scan
- Verify timeout enforcement: deliberately create a fixture that hangs and confirm 5-min timeout kills it
- Verify memory cap: deliberately allocate > 2GB in a test container and confirm OOM kill
- Test on macOS and Linux at minimum. Windows Docker Desktop has known networking quirks; document any issues but don't block v1.0 on it.

### 11b.2 AST Parsing with @typescript-eslint/parser

**The trap:** The parser's API is complex and version-sensitive. LLMs generate plausible-looking AST traversal code that doesn't compile, references methods that don't exist on the current parser version, or returns wrong node types.

**Verification protocol:**

- Build the AST wrapper as one of the first tasks in Phase 1B
- Pin `@typescript-eslint/parser` version explicitly; commit to that version through v1.0
- Test against 3 real public TS repos (e.g., `tanstack/query`, `colinhacks/zod`, `pmndrs/zustand`) before declaring the AST layer done
- For each fixture: parse the repo, run `findReferences` on a known symbol, verify the result matches manual inspection
- Write unit tests for wrapper functions with real (not synthetic) code samples
- If an LLM-generated function returns no results, suspect API misuse before suspecting the test repo

### 11b.3 GitHub API Edge Cases

**The trap:** LLMs know the happy path (clone repo, create PR) but miss error states: rate limiting, pagination, fork-vs-clone decisions, PAT scope validation failures, retry semantics, network flakes.

**Verification protocol:**

- Wrap octokit calls in a consistent error-handling layer that catches and categorizes: rate-limit, auth, network, validation, other
- Test rate-limit handling deliberately: use a low-rate-limit PAT and run a scan; verify backoff works
- Test PAT scope validation on entry: try a PAT missing `repo` scope and verify graceful rejection
- Test pagination: list a repo with > 100 open PRs and verify all are fetched correctly
- Test fork detection: scan a repo where the user already has a fork vs. one where they don't; verify correct path in both cases
- Test the dedup query on a repo with an existing matching PR

### 11b.4 SSE Streaming (Agent → Browser)

**The trap:** Getting Server-Sent Events plumbing right across Next.js API routes is fiddly. Common failures: events buffer instead of streaming live, connection drops mid-stream, client misses events because EventSource reconnects with wrong state.

**Verification protocol:**

- Build SSE plumbing during Phase 1C and test it explicitly before integrating with agent reasoning output
- Verify events stream live (not buffered): instrument a test endpoint that emits one event per second for 10 seconds; client should see them appear one by one, not all at once at the end
- Verify reconnection handling: simulate a connection drop mid-stream and confirm the client recovers without duplicating events
- Add a heartbeat event every 15s so dead connections are detected
- Maintain stream state in a Zustand store on the client — don't rely on EventSource's automatic reconnect alone

### 11b.5 General Vibe-Coding Discipline

- **For these 4 areas specifically: write code, then verify against a real fixture before claiming done.** Saying "this should work" doesn't count.
- If LLM-generated code *looks* obviously correct but doesn't work, the issue is usually a hallucinated API method or argument shape. Verify against current official docs, not training data.
- When verification fails 3 times in a row, stop and write a `STATE.md` note. Don't keep retrying the same approach.

## 12. Kill Criteria (Project Health)

If any of these trigger, stop building features and address:

- **Weekend 5 and v1.0 not shipped** → drop test coverage feature entirely; reduce demo PR count to 2; ship something.
- **Spent 2+ hours on a single Docker/networking issue** → simplify the approach or defer to v1.5; don't bash head against networking edge cases.
- **LLM output is unreliable for a given task type** (e.g., search-replace blocks failing > 30% of the time) → fall back to safer alternative (e.g., full-file regen), document in `STATE.md`, surface tradeoff to owner.
- **A repo type causes 3+ consecutive scan failures** → reject that repo type in v1.0; document; move on.

The project's failure mode is *abandonment from frustration*, not *insufficient features*. Optimize for shipping.

## 13. When Stuck

If something isn't working after 3 attempts:

1. Stop. Don't dig deeper.
2. Write a short note in `STATE.md`: what was tried, what failed.
3. Surface to owner with: (a) what was attempted, (b) hypothesis on why it failed, (c) 2 paths forward with tradeoffs.
4. Wait for direction.

## 14. Reference

- PRD: `/PRD.md` (mirrored in Notion) — Rev 4 inserts Phase D §17b
- TRD: `/TRD.md` (mirrored in Notion) — unchanged in Rev 4 (Phase D is frontend-only)
- [**DESIGN.md](http://DESIGN.md): `/DESIGN.md`** (mirrored in Notion, sibling doc) — visual + motion + component source of truth from Phase D forward
- Security rules: project's Security-First Vibe Coding Rules in Notion
- Owner communication preferences: §0
- Confidence framing: §5b (re-read before any agent logic or PR submission work)
- **Phase D workflow: §6b** (re-read before any UI work)
- Phase boundaries: §11 forbidden patterns + §12 kill criteria

---

## Revisions

**Rev 4 (2026-05-20)** — Phase D Design Iteration inserted. v1.0 shipped functionally; UI did not earn PRD §13 brief; three screens (S5/S6/S7) never built. §1 updated with current phase status. §3 file structure updated for hybrid route architecture (9 screens → 6 routes). §6 Skills subsection updated to warn against `/website-builder-setup` skill for primary UI. §6b added (Phase D workflow rules + anti-patterns). §9 Definition of Done adds Phase D criteria. §11 Forbidden Patterns extended with Phase D additions. §14 Reference adds [DESIGN.md](http://DESIGN.md). TRD unchanged (Phase D is frontend-only). Companion docs: PRD Rev 4, [DESIGN.md](http://DESIGN.md) Rev 1 (new doc).

**Rev 3 (2026-05-18)** — phased delivery split (v1.0 vs v1.5); capability honesty pass; added §5b v1.0 framing rules (Draft PRs, amber-only badges); added §12 Kill Criteria; tagged every feature for phase; updated forbidden patterns to prevent v1.5-into-v1.0 leakage.

**Rev 2 (2026-05-18)** — added confidence rules, two-phase sandbox, semantic diffing, Prettier-based style, monorepo rejection, collision-safe branches, PR dedup.

**Rev 1 (2026-05-18)** — initial draft.

---

*Source of truth for this codebase. When something here conflicts with a one-off request, ask before deviating.*