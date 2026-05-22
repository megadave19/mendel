# STATE.md — Mendel Session State

> Living log. Read at session start. Update after every meaningful session or state change.
> **Last updated:** 2026-05-21
> **Current phase:** Phase D — Design Iteration (sub-phase D1: Doc + Assets, ~65% complete)

---

## Status Summary

v1.0 shipped functionally on 2026-05-20 — agent works end-to-end, real Draft PRs landed on `megadave19/mendel-test` (axios 0.24 → 1.16.1, typescript 5.0 → 6.0.3). Functional product complete; UI did not earn the PRD §13 cyberpunk-CRT brief and three planned screens (S5/S6/S7) were never built.

**Phase D inserted between v1.0 and v1.5** to fix both before v1.5 detection work begins. Currently in **sub-phase D1** (Doc + Assets). DESIGN.md Rev 1 published. Mascot named **Bones**, tooling locked to **Rive 2D**. Immediate next deliverable is Bones idle pose in Rive.

---

## What's Shipped (v1.0)

- All v1.0 agent functionality per PRD §10 features F1–F11
- Two-phase Docker sandbox (network=bridge → network=none)
- Changelog-only detection signal
- Full-file patch generation (max 3 files)
- Draft PR submission with "medium confidence" framing + "Not Analyzed" disclosure
- 6 of 9 originally-spec'd screens shipped (S1, S2, S3, S4-shell, S8, S9) — visual quality below brief
- 2 real Draft PRs on `megadave19/mendel-test`

## What's NOT Shipped (v1.0 gaps → Phase D scope)

- **S5 Issues List** — never built (now inline state + permalink in Phase D)
- **S6 Fix Detail** — never built (now inline state + permalink; the screen where calibrated-confidence positioning lives)
- **S7 PR Confirmation** — never built (now inline state + permalink)
- **S4 Live Console** — route exists but renders empty log; three-pane spec absent (mascot+state | streaming reasoning | 3D dep graph)
- **Cyberpunk-CRT aesthetic** — PRD §13 specified, generic dark SaaS shipped
- **3rd demo PR** — only 2 of target 3 landed (under v1.0 acceptance criteria; revisit during Phase D Loom re-record)

---

## Phase D Progress

| Sub-phase | Scope | Status |
| --- | --- | --- |
| D1 — Doc + assets | DESIGN.md ✅, MascotWidget placeholder + abstraction boundary ✅, mascot 3D model owner-side (async), ref screenshots pending | 🟢 Code-side complete; mascot art async/non-blocking |
| D2 — S1 + S4 (motion-heavy) | Boot sequence + Live Console rebuild | 🟢 Built — awaiting PM visual review |
| D3 — S5/S6/S7 inline + permalink | Issue cards, fix detail, PR confirm — dual-mode components + REAL data wiring | ✅ UI + real-stream + persistence wired |
| D4 — S2/S3/S8/S9 redesign | Rest-mode density pass | ⬜ Not started |

**D1 progress detail:**
- ✅ DESIGN.md Rev 1 published (~50% of D1 effort)
- ✅ Mascot tooling locked: Rive 2D
- ✅ DESIGN.md §12.1 dual-mode component contracts added (closes D3 architecture gap pre-emptively)
- ✅ **Rive React scaffold complete (2026-05-21)** — `@rive-app/react-canvas@4.28.5` (React 19 compatible), `components/MascotWidget.tsx`, `/dev/mascot` isolation route, 5 contract tests. Typecheck/lint/test green, route renders 200. **NOT the art** — wiring only.
- ⏳ **Bones art in Rive 2D — idle pose first** (Rive editor work, outside code session). `.riv` drops at `/public/mascot/bones.riv`; contract: state machine `"Bones"`, Number input `"pose"` (0=idle … 8=error per `POSE_INDEX`).
- ⏳ PM manual walk-through of `/dev/mascot` scaffold (CLAUDE.md §7.2) — not yet done; scaffold not declared "done" until then
- ⏳ Then: scanning, thinking, detecting, patching, success poses animated in the state machine
- ⏳ Reference screenshots from .mov recordings collected & folded into DESIGN.md §7

---

## Next Task (immediate)

D3 real-data wiring is **done** (live stream → S4, issues persisted, API maps to IssueVM). Remaining Phase D work:

1. **End-to-end smoke test of a real scan** through the new S4 (paste a repo at /scan/new → confirm live stream renders in three-pane + issue card enriches on completion + permalinks show real data). Needs a classic PAT with `repo` scope in session.
2. **D4 — rest-mode screens** (PAT modal, New Scan, Dashboard, Settings) structurally, OR hand off for the external visual re-skin per PM's plan.
3. **Optional:** permalink pages still render MOCK_ISSUE — switch them to fetch GET /api/scans/[id] and select by issueId/prId for fully real permalinks.
4. **Optional:** real dep-graph data (§15 Q3) — currently MOCK_DEPS visual.

**Deferred (PM plan):** visual polish / Awwwards-bar treatment later with a dedicated design tool. Claude's role: keep structure clean + functional.

---

### (superseded) PM visual review of D2 — open in browser (dev server on :3000):
- `/` — S1 boot sequence. Watch the power-on → mascot → type-on MENDEL → reveal. Should feel like equipment booting, "this is a thing" within ~4s.
- `/scan/demo` (any id) — S4 Live Console. Confirm all three panes animate together: mascot pose changes per phase, stage lane advances SCAN→DIAGNOSE→PATCH→VERIFY, log streams with type-on, 3D dep graph rotates + active node pulses. Press F5 to replay.
- Check `prefers-reduced-motion` (macOS: System Settings → Accessibility → Display → Reduce motion) — S1 should jump straight to interactive.

Round 1 review = "does it match the brief?" Then round 2 = "does it feel right?" (DESIGN.md §14).

**Then D3** — S5/S6/S7 inline issue cards + permalink routes + reconnect real `useScanStream` into the S4 layout (replaces the mock driver for live scans).

**Parallel, owner-side (non-blocking):** 3D mascot model → share `.glb`/`.gltf` when ready. Collect .mov refs → DESIGN.md §7 (§15 Q5).

---

## Open Questions

| # | Question | Status |
| --- | --- | --- |
| DESIGN.md §15 Q5 | Reference screenshots from .mov recordings | ⏳ Not blocking; will sharpen motion specs in DESIGN.md §7 |

**Resolved (logged for history):**
- DESIGN.md §15 Q1 Mascot name → **Bones** (2026-05-20)
- DESIGN.md §15 Q2 Mascot tooling → **Rive 2D** (2026-05-20)
- DESIGN.md §15 Q3 3D dep graph data → **real dep data** (2026-05-20)
- DESIGN.md §15 Q4 Sound design → **v2, defer after v1.5** (2026-05-20)

---

## Recent Decisions (newest first)

**2026-05-22 (LLM resilience + provider abstraction)**
- **Fixed the retry bug** (provider-agnostic): `classifyError()` distinguishes daily-quota (fail fast — won't reset for hours), transient 503/per-minute-429/network (bounded backoff, max 3, honors retry hint, ≤60s), schema (retry with feedback), fatal (give up). Stops the quota-burning `waiting 15s before retry` loop. 5 tests.
- **LLM provider abstraction** — `lib/llm/index.ts` now dispatches by `LLM_PROVIDER` env: `gemini` (default — behavior/quality unchanged) or `github-models` (free, OpenAI-compatible via fetch, no SDK dep). Shared retry/schema loop wraps both. Env documented in `.env.example` (GITHUB_MODELS_TOKEN/MODEL/BASE_URL). 3 tests lock default=gemini.
- **Quality note:** abstraction is pure plumbing — zero quality/perf impact at default (Gemini). GitHub Models (GPT-4o-mini/4o) is comparable quality; its tradeoff is free-tier rate/token caps, not output quality.
- **Prompt caching: evaluated, NOT added.** It cuts token cost/latency, not request count — does nothing for the RPM/RPD rate-limit wall, and doesn't change functionality. Not worth the Gemini context-cache overhead at this volume.
- 39/39 tests, typecheck + lint clean.

**2026-05-21 (D3 — real data wiring complete)**
- **Discovered the runner never persisted Issue rows** — only updated scan counts. So GET /api/scans/[id] always returned empty issues; no issue detail was stored anywhere. Fixed.
- **`lib/agent/issue-vm.ts`** — single source for (a) `persistIssueData()` building the DB blobs and (b) `dbIssueToVM()` parsing them back (Zod-validated). Enforces §5b: confidence always "medium", Not-Analyzed disclosures always present. Diff preview = manifest version bump + per-file explanations (full-file rewrites don't yield a cheap line diff).
- **Runner persists each finding** via `db.issue.create` after SUBMIT (captures prUrl). Wrapped in try/catch so a persist failure doesn't abort the scan.
- **GET /api/scans/[id]** now returns `issues: IssueVM[]` (mapped); raw DB issues never leak to client.
- **`hooks/use-scan-view.ts`** — unified view model. `id === 'demo'` → mock (interactive demo); any real id → live SSE via useScanStream, mapping AgentEvent → phase/log/issue cards, then fetches GET /api/scans/[id] on completion to enrich cards with persisted diagnosis/diff/Not-Analyzed. Both hooks always called (rules-of-hooks safe); args disable the unused one.
- **S4 uses `useScanView(id)`.** Manual "Open Draft PR" button only in demo — real scans are autonomous (agent opens the PR; UI observes via the 'pr' event → S7 state). IssueCard hides action buttons when no `onOpenPR` handler is passed.
- **Verified:** typecheck + lint clean, 29/29 tests, build 13/13 routes.
- **Note:** dep graph still renders MOCK_DEPS in both modes (the SSE stream doesn't carry the full dep tree; real dep-graph data is a separate task, §15 Q3). Live issue cards show "Diagnosing…" placeholders until the on-done enrichment fetch returns full detail.

**2026-05-21 (D3 — S5/S6/S7 inline + permalink, UI built)**
- **PM called the frontend polish a poor use of time/tokens** and chose to: build structure/functionality now, re-skin visuals later with a tool better suited to design. Pivoted from visual iteration to functional buildout. Components kept well-structured + on-brand-enough for easy re-skinning.
- **Dual-mode component set built** (DESIGN.md §12.1): `ConfidenceBadge` (amber/medium, v1.0 §5b), `NotAnalyzedCallout` (running pulses / rest static), `DiffViewer` (running stagger / rest static), `IssueCard` (collapsible — absorbs S5 collapsed / S6 expanded / S7 pr-opened in one component). All take `context: 'running' | 'rest'`.
- **IssueVM view model** added to phase-d/types — the shape S5/S6/S7 render; produced by both mock and (later) real stream so source is irrelevant.
- **S4 center pane** now streams the inline issue card (S5) → expand for diagnosis+diff+Not-Analyzed (S6) → Open Draft PR → success morph (S7).
- **Permalink routes** created: `/scan/[id]/issue/[issueId]` (S6) and `/scan/[id]/pr/[prId]` (S7) — reuse the same IssueCard in REST context (DESIGN.md §10 hybrid). 13 routes total, build passes.
- **Still mock data.** Two follow-ups remain to make D3 fully real: (1) reconnect `useScanStream` into the S4 layout (replace mock for live scans); (2) map DB `Issue` → `IssueVM` in the API + permalink routes (currently render MOCK_ISSUE). Both are contained by the shared IssueVM/Phase/LogLine types.

**2026-05-21 (D2 — S1 redesigned against reference design language)**
- **First D2 pass was AI-slop** (flat 1px panels, monotone, broken-looking placeholder). PM rejected. Root cause: built from text descriptions of references never actually viewed + didn't use design skills.
- **Owner supplied 3 reference design languages** (pixel-hand interactive UI, Hashgraph crystal hero, unified summary). Distilled philosophy: pure-black infinite canvas, ONE isolated hero, light glows from WITHIN objects, motion is material (assemble/shatter/morph — physical consequence per state change), corner HUD overlays (ms timer, cycling state word), extreme type hierarchy, the canvas breathes.
- **Reconciliation:** kept Mendel's semantic palette (lime/amber/danger = confidence, CLAUDE.md §5b non-negotiable); applied the references' *treatment* to our lime rather than adopting their pink/purple.
- **Invoked `ui-ux-pro-max` skill** — confirmed JetBrains Mono + dark/phosphor + "avoid flat design without depth."
- **New S1 hero: `PixelSkullHero`** (canvas 2D) — Bones assembles from a particle cloud onto a sampled skull pixel-grid, then a wireframe ghost-skull traces in; ambient comet particles drift continuously. Solves TWO problems: nails the "this is a thing" payoff AND replaces the broken placeholder with something intentional. The owner's eventual 3D model can slot into this hero slot later.
- **S1 rebuilt** with corner HUD (MENDEL//v1.0 pill, ◇ cycling state word, live ms uptime timer, DRAFT-ONLY flag), extreme type, single glowing accent, pure black.
- **Verified visually via Claude Preview** (screenshotted the running page — first time actually *looking* at output). Skull reads clearly; composition holds. typecheck/lint clean.
- **S4 (Live Console) NOT yet re-treated to this bar** — still the earlier three-pane build. Next: apply the same reference language to S4 after PM approves S1 direction.

**2026-05-21 (D2 — S1 boot + S4 Live Console built)**
- **Phase D component library created** under `components/phase-d/`: `ScanlineOverlay`, `PanelFrame`, `StatusPill`, `StageLane`, `TerminalLog`, `CommandBar`, `DepGraph3D`, plus shared `types.ts` (Phase/Stage/LogLine + PHASE_TO_POSE map). Hooks: `use-type-on` (DESIGN.md §7 type-on), `use-mock-scan` (scripted scan playback).
- **S1 rebuilt** (`app/(marketing)/page.tsx`) as a real boot sequence per DESIGN.md §7: CRT power-on (canvas scale + scanline-noise fade) → mascot phosphor-warm → type-on wordmark → headline drift → staggered corner labels → interactive at ~3.3s. Reduced-motion jumps straight to interactive.
- **S4 rebuilt** (`app/(app)/scan/[id]/page.tsx`) as the three-pane Live Console (DESIGN.md §11 S4): [mascot+state+stats] | [stage lane + streaming log] | [3D dep graph], over an F-key CommandBar. Driven by `useMockScan` so all three panes animate end-to-end (D2 gate).
- **DepGraph3D uses VANILLA Three.js, not R3F.** Reason: `@react-three/fiber@8` targets React 18 and breaks under this project's React 19; `three@0.170` is React-agnostic. Visual outcome matches DESIGN.md §9. **Deviation from §9's "R3F" wording — should be reflected in DESIGN.md §9 when next editing the doc.**
- **S4 is mock-driven for D2.** The real `useScanStream` reconnection + inline issue cards (S5/S6/S7) are D3. Mock and live share the `Phase`/`LogLine` shapes so the swap is contained. **Interim regression: real scans submitted from /scan/new currently show the mock playback, not their live data — resolved in D3.**
- **Verification:** `pnpm build` passes (10/10 routes prerender, no SSR errors), typecheck + lint clean, 29/29 tests. Runtime WebGL/boot visuals pending PM in-browser review.

**2026-05-21 (later — mascot tooling pivot: Rive → 3D model)**
- **§15 Q2 re-opened and re-decided.** Rive 2D was unworkable for a no-cost solo-PM project: it requires drawing + rigging a multi-part character (designer skills), and Rive's AI agent code-gen path crashes on their own backend. Owner is building a **3D model** themselves instead.
- **Mascot tooling now: 3D model (owner-supplied), to be wired via R3F.** Likely a `.glb`/`.gltf` loaded into an R3F `<Canvas>`, mapping `MascotPose` → animation clips. R3F is already in the stack.
- **`@rive-app/react-canvas` removed.** It was unused after the pivot and risked re-triggering the `self is not defined` build-cache crash on future installs.
- **`MascotWidget` is now a pure, dependency-free placeholder** and serves as the **abstraction boundary**: every screen consumes `<MascotWidget pose={...} />`; the 3D model wires in behind that one interface with zero changes to consuming screens. Dropped Rive-specific exports (`POSE_INDEX`, `STATE_MACHINE`, `POSE_INPUT`); kept `MascotPose` union + new `MASCOT_POSES` array. Tests updated (29/29 green).
- **Mascot art is now async/owner-side and explicitly non-blocking.** D2 proceeds with the placeholder. Owner shares the model later → Claude wires it in.

**2026-05-21 (D1 — Rive React scaffold)**
- Installed `@rive-app/react-canvas@4.28.5` (declares React 19 in peer deps — no compat issue; the react-spring/@react-three/fiber peer warnings on install are pre-existing, unrelated to Rive).
- **Bones pose taxonomy locked at 9 states** (idle, scanning, thinking, detecting, patching, verifying, success, failure, error). DESIGN.md §8 lists 10 rows; the 10th, `uncertain`, is v1.5-gated and intentionally excluded. Adding it later is a one-line change to the `MascotPose` union + `POSE_INDEX`. This reconciles the brief's "9 states" with §8's 10 rows — not an oversight.
- **React ↔ Rive contract:** state machine `"Bones"`, Number input `"pose"`, integer 0–8 (`POSE_INDEX`). Exported as constants from `MascotWidget.tsx` so the `.riv` designer and the contract test share one source of truth.
- **Component path:** followed the brief exactly → `components/MascotWidget.tsx` (top-level), not `components/mascot/`. Legacy `components/mascot/skull.tsx` (v1.0 SVG mascot, different/older state taxonomy) is left untouched this session; it gets retired in D2 once MascotWidget is wired across screens. Fallback is a self-contained on-brand placeholder, deliberately NOT coupled to skull.tsx (old vs new taxonomy would create friction).
- **Verification:** typecheck clean, lint clean, 29/29 tests (5 new contract tests), `/dev/mascot` renders HTTP 200 with no runtime errors. Scaffold NOT declared "done" — pending PM walk-through (§7.2) and the actual `.riv` art.

**2026-05-20 (later — Phase D readiness review)**
- Claude Code caught 3 internal doc contradictions; all fixed via Notion MCP:
  - PRD §17b D1 row de-Rive-hardcoded and updated for partial completion (DESIGN.md done)
  - CLAUDE.md §6b route count clarified: 5 primary + 2 permalink sub-routes = 7 total (was ambiguously "6")
  - DESIGN.md §12.1 added: dual-mode behavior spec for `<IssueCard>`, `<NotAnalyzedCallout>`, `<DiffViewer>` (`context: 'running' | 'rest'` prop) — closes D3 architecture gap before it surfaces
- Mascot tooling locked: **Rive 2D**. Driven by §8 comic-mascot brief that 2D reads better, built-in state machine for phase triggers from React, 50KB bundle cost is negligible.

**2026-05-20**
- Mascot named **Bones**. Operator of the Mendel machine, distinct from the Mendel brand. (DESIGN.md §8)
- DESIGN.md Rev 1 published as sibling to PRD/TRD/CLAUDE.md.
- **Screen architecture revised:** S5/S6/S7 collapse into S4 (Live Console) as inline states + permalink routes. 9 screens → 6 screens on 7 routes (5 primary + 2 permalink). (PRD §14, DESIGN.md §10)
- PRD updated to Rev 4 with §17b Phase D inserted.
- CLAUDE.md updated to Rev 4 with §6b Phase D workflow rules + anti-patterns.
- TRD unchanged (Phase D is frontend-only — verified).
- v1.5 work paused until Phase D Gate D4 passes.
- `website-builder-setup` skill flagged as non-canonical for Mendel's primary UI; `frontend-design` skill is the right tool.

---

## Active Blockers

None.

---

## Notes for Next Session

- Load `frontend-design` skill first.
- Read DESIGN.md §0–§10 and §12.1, plus CLAUDE.md §6b, before any UI work.
- First concrete deliverable: Bones idle pose in Rive 2D.
- If D1 extends beyond 0.5 weekends remaining, surface to owner per CLAUDE.md §12 kill criteria.
- v1.5 work is paused. Don't sneak it in.
- Pre-D3 readiness gate: re-read DESIGN.md §12.1 — confirm the dual-mode component contracts are buildable. Surface any issue before opening D3.