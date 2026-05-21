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
| D2 — S1 + S4 (motion-heavy) | Boot sequence + Live Console rebuild | 🟡 Starting (placeholder mascot) |
| D3 — S5/S6/S7 inline + permalink | Issue cards, fix detail, PR confirm — dual-mode components per DESIGN.md §12.1 | ⬜ Not started |
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

**Start D2 — S1 boot sequence + S4 Live Console rebuild — using the MascotWidget placeholder.**
The mascot 3D model is being built owner-side (async, non-blocking). All D2 screens integrate against `<MascotWidget pose={...} />`; the placeholder stands in until the model lands.

**Parallel, owner-side (non-blocking):**
- Build the 3D mascot model. Share the exported file (`.glb`/`.gltf`) when ready → Claude wires it into MascotWidget behind the existing `pose` interface.
- Collect .mov reference screenshots → fold into DESIGN.md §7 (DESIGN.md §15 Q5).

**Scaffold sign-off:** ✅ PM confirmed `/dev/mascot` works ("scaffold looks good") on 2026-05-21.

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