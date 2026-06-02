# Design.md - Mendel

# [DESIGN.md](http://design.md/) — Mendel Design System

> **Revision 2** | Last updated 2026-05-28 | **Status: Active**
> 
> 
> Sibling document to [PRD.md](http://prd.md/), [TRD.md](http://trd.md/), [CLAUDE.md](http://claude.md/), [V2_PLAN.md](http://v2_plan.md/). Source of truth for all visual, motion, and component design decisions.
> 
> **Rev 2 (2026-05-28)** — v2 design additions. The design system is **locked**; v2 extends, never reinvents. Changes: §7 StageLane gains a **5th lane (SMOKE)**; §8 adds **one** new mascot pose, **"watching"** (continuous monitoring); §9 reconciled to **vanilla Three.js** (R3F broke on React 19); §11 adds per-screen briefs for **/inspect, /watchlist**, the **auto-merge & MCP Settings panels**, and the dev-only **/dev/eval**; §12 adds **`<LangBadge>`** + the **smoke sub-panel**. Every other v2 surface reuses existing components. Anti-references (§13) bind unchanged.
> 

---

## 0. Purpose

This document is the visual and motion source of truth for Mendel. Every UI component, every screen, every animation is built against this doc. No UI code is written without first reading this doc and the `frontend-design` skill.

It exists because the v1.0 UI shipped as generic dark-mode SaaS ("AI-slop") despite the PRD specifying an "Awwwards-tier cyberpunk + CRT" aesthetic. The PRD described the destination; this doc describes how to actually get there.

---

## 1. Context — What Phase D Fixes

**Phase D** is a design iteration inserted between v1.0 (shipped) and v1.5 (planned). Trigger: v1.0 ships functionally — the agent works, real Draft PRs land on GitHub — but the UI does not earn the product's positioning. Three problems:

1. **Generic execution.** Dark background + lime accent + monospace ≠ cyberpunk-CRT aesthetic. The brief was never actually executed.
2. **Three screens missing.** S5 (issues list), S6 (fix detail with diagnosis + diff + "Not Analyzed"), S7 (PR confirmation) do not exist. These are the screens where the calibrated-confidence thesis lives.
3. **Live Console is a shell.** S4 exists as a route but renders an empty log. The PRD-spec three-pane (mascot+state | streaming reasoning | 3D dep graph) is absent.

Phase D produces this doc, then rebuilds the visual layer + completes the missing screens, **before** v1.5 work begins.

---

## 2. The Synthesis

> **Mendel is a diagnostic machine with three modes.**
> 

> 
> 

> **At boot:** cinematic restraint, slow reveal, one focal hero.
> 

> 
> 

> **Running:** kinetic energy, particles, reactive state, mascot performing.
> 

> 
> 

> **At rest:** dense analog readouts, retro chrome, always-on idle hum.
> 

> 
> 

> **Same machine, three energies.**
> 

This is the organizing principle. Every design decision below derives from it. When in doubt, ask: *which mode is this screen in, and what energy does that mode demand?*

---

## 3. Mode Map

| Mode | Energy | Screens |
| --- | --- | --- |
| **Boot** | Cinematic, restrained, slow, atmospheric. 90% empty space. One hero. | S1 Landing |
| **Running** | Kinetic, reactive, particle-dense, mascot performs, mechanical state changes. | S4 Live Console |
| **Rest** | Dense analog readouts, retro chrome, dashboards, idle life (cursors, hum, slight drift). | S2 PAT Modal, S3 New Scan, S8 Dashboard, S9 Settings, S5/S6/S7 permalink views |

---

## 4. Design Pillars (the four inputs + the operator)

Each input occupies a non-overlapping role. They do not blend; they layer.

| Pillar | Role | Where it shows up |
| --- | --- | --- |
| **Teenage Engineering** | The machine's physicality. Chunky panels, things that click/slot, weight to state changes. | Panel borders, button press states, the way issue cards "land" in their lanes. |
| **90s Cyberpunk Analog** | The world the machine lives in. CRT phosphor, scanlines, terminal text, ASCII flourishes. | Background scanline overlay, CRT curvature on hero moments only, type-on effects, ASCII section dividers. |
| **Nixtio Dashboard** | The readout aesthetic. Dense, bold, color-coded data blocks. | S8 Dashboard, scan history table, stat cards. |
| **The Ratio** | The chrome. Terminal window frames, F-key bars, wireframe-3D moments. | Live Console pane frames, command-bar at bottom of S4, wireframe 3D dep graph. |
| **The Mascot (operator)** | Not the brand — the guy in the basement running the machine. Comic timing. | Bottom-left sidebar (idle), S1 hero (boot), S4 left pane (performing). |

---

## 5. Color System

Refined from PRD §13. Hex unchanged; **semantic roles tightened.**

```css
/* Backgrounds */
--bg-0: #0A0A0A;   /* Page background. Near-black, not pure. */
--bg-1: #111111;   /* Panel base. */
--bg-2: #1A1A1A;   /* Elevated panel / hover state. */
--bg-3: #222222;   /* Input fields, code blocks. */

/* Accents — semantic */
--phosphor:  #C6FF3D;  /* Lime. Running mode primary. Success. Active state. */
--cyan:      #3DFFEE;  /* Links. Secondary highlights. The Ratio chrome accents. */
--amber:     #FFB84D;  /* Medium confidence (v1.0 default). Warnings. CRT amber. */
--danger:    #FF4D5E;  /* Low confidence. Errors. Failed verifications. */

/* Text */
--text-0: #F5F5F5;  /* Primary. */
--text-1: #9A9A9A;  /* Secondary. */
--text-2: #555555;  /* Muted, hints. */
--text-3: #333333;  /* ASCII dividers, decorative. */

/* Glows (use sparingly — never on rest-mode screens) */
--glow-phosphor: 0 0 24px rgba(198, 255, 61, 0.35);
--glow-cyan:     0 0 16px rgba(61, 255, 238, 0.30);
--glow-amber:    0 0 16px rgba(255, 184, 77, 0.30);
--glow-danger:   0 0 18px rgba(255, 77, 94, 0.35);
```

**Rules:**

- Phosphor is the most expensive color. Use it for active/success/primary-CTA only. If everything is phosphor, nothing is.
- Amber dominates v1.0 because every PR is "medium confidence — review required." In v1.5 phosphor/amber/danger split by confidence bucket.
- Cyan is for links + The-Ratio-style chrome (terminal headers, F-key labels). Never for primary CTAs.
- Glows only in boot and running modes. Rest mode is flat (idle hum is motion, not glow).

---

## 6. Typography

```css
--font-display: 'JetBrains Mono', monospace;  /* Headings, hero, status labels */
--font-body:    'Geist Sans', system-ui;       /* Long-form text, descriptions */
--font-code:    'JetBrains Mono', monospace;   /* Code, terminal, monospace UI */
```

**Scale (Tailwind classes):**

| Token | Tailwind | Use |
| --- | --- | --- |
| `display-xl` | `text-7xl font-bold tracking-tight` | Landing hero ("MENDEL") only |
| `display-lg` | `text-5xl font-bold` | Screen H1 (Scan a Repository, Dashboard) |
| `display-md` | `text-3xl font-bold` | Card titles, section headers |
| `body-lg` | `text-lg` | Lead paragraphs |
| `body` | `text-base` | Default body |
| `body-sm` | `text-sm` | Meta, captions |
| `label` | `text-xs uppercase tracking-[0.15em]` | UI labels, status tags |
| `mono-code` | `text-sm font-mono` | Code, terminal output |

**Rules:**

- `font-variant-numeric: tabular-nums` on every number (stats, timestamps, version numbers).
- All-caps + wide tracking for labels only. Never for body.
- Don't use display-xl outside S1. It loses meaning if reused.

---

## 7. Motion Principles

**Universal rule:** motion is mechanical, not soft. Things *slot, click, settle.* No Material-spring bounce. No fade-only transitions when a slide would carry weight.

### Boot mode (S1 only)

| Beat | Spec |
| --- | --- |
| CRT power-on (page load) | 800ms ease-out, scale 0.96→1, opacity 0→1, scanline noise overlay fades from 0.4→0.08 over 1200ms |
| Phosphor warm | Mascot glow 0→1 over 1200ms, slight delay after silhouette appears |
| Type-on hero text | 35ms per character, monospace cursor blinks at 530ms |
| Headline reveal | After type-on completes, slight upward drift (8px) + opacity, 600ms ease-out |
| Stagger | 150ms between corner labels |

### Running mode (S4)

| Beat | Spec |
| --- | --- |
| Stage transition (issue moves SCAN→DIAGNOSE→PATCH→VERIFY→SMOKE) | Pill slides between lanes, 280ms `cubic-bezier(0.65, 0, 0.35, 1)`. **[v2]** The 5th lane (SMOKE, F20) is data-driven — the StageLane already renders a configurable lane set, so this is a config change, not a layout rewrite. |
| Status LED pulse | 2s loop, glow opacity 0.4→0.8→0.4, ease-in-out |
| Particle stream | Continuous, 60fps target, opacity 0.3–0.6, slight motion blur. Density tied to active workload. |
| Mascot pose change | 180ms snap, no easing (mechanical, not animated-bounce) |
| New log line | Type-on at 22ms/char (faster than hero), auto-scroll smooth |
| Confidence badge land | 220ms drop-in + 60ms settle bounce (single overshoot, mechanical) |

### Rest mode

| Beat | Spec |
| --- | --- |
| Idle cursor blink | 530ms |
| Number flicker on update | 80ms flash to white, then settle to phosphor |
| Row hover | 120ms ease-out, bg shifts to `--bg-2` |
| Scanline drift (subtle, page-wide) | 12s loop, 2px vertical translation, 0.04 opacity |
| Panel hover lift | 1px translateY up, 120ms ease-out, no scale |

### Reduced motion

Respect `prefers-reduced-motion`. Boot becomes instant fade-in. Running motion drops particles and stage-slides; status badges still update (but instantly). Rest mode is unaffected.

---

## 8. The Mascot — Bones

**Name:** Bones. He's the operator of the Mendel machine. The distinction matters: **Mendel is the product wordmark; Bones is the character.** Mendel is the equipment Bones runs. The interview story stays clean — "I designed a calibrated diagnostic machine with a character operating it," not "I designed a product mascot."

**Visual spec:**

- Skeleton character. **Oversized skull (~1.5× normal head ratio), small/stubby body.** Comic proportions.
- Personality: dry humor, unbothered, occasionally smug. Reacts visibly to what the machine finds — bored when idle, focused when scanning, vaguely offended when a PR gets rejected.
- He is **the operator**, not the brand. The Mendel wordmark is the brand. Bones is the guy at the console.

**Animation states** (tied to agent phases — refined from PRD §13):

| State | Mascot behavior | Trigger |
| --- | --- | --- |
| Idle | Slow float-bob, blinks every 4–6s, occasional yawn or scratch | No active scan |
| **Watching (v2)** | Idle variant — holds a small radar/scope, slow horizontal sweep; passive vigilance, not active work | Continuous monitoring active (F25). The **one** new pose in all of v2. |
| Scanning | Holds magnifying glass, head tracks left-right | Scan started |
| Thinking | Tilts head, taps temple, eye glow shifts cyan | Diagnosis running |
| Detecting | Eyes widen, head snap to attention | Issue found |
| Patching | Holds wrench, sparks occasionally fly | Patch generation |
| Verifying | Reading from clipboard, checkmark stamp on each test pass | Sandbox running |
| Uncertain (v1.5) | Scratches skull, eye glow flickers between cyan and amber | Signals disagree |
| Success | Throws arms up, brief lime burst behind him | PR opened |
| Failure | Slumps, eye glow fades to danger-red briefly | Verification failed |
| Error | Static/glitch overlay on character, eyes Xs | System error |

**Recommended tooling:** **Rive 2D** for animation states (lighter, easier to iterate, supports state-machine triggers from React). Three.js / R3F is fine if you want a low-poly 3D mascot but adds weight to bundle and complexity to iterate. **Decision deferred — see §15 Open Questions.**

**Anti-rule:** the mascot does NOT explain things to the user. No speech bubbles, no captions, no "Hi! I'm Skel!" tone. He reacts. He's a character, not a chatbot.

---

## 9. 3D Usage

Sparing, but real. Three places:

1. **S1 Landing hero.** A 3D wireframe object behind/around the mascot — a slowly rotating low-poly skull, or a wireframe "machine" the mascot operates. Inspired by The Ratio's wireframe-head moment. Built with R3F (already in stack).
2. **S4 Live Console center/right pane.** Wireframe-3D dependency graph showing the repo's dep tree. Nodes pulse when touched by analysis. This is the PRD-spec "3D dependency graph" finally rendered.
3. **Mascot (optionally).** If we go low-poly 3D instead of Rive 2D, he becomes the third 3D moment. Otherwise he stays 2D Rive.

3D is **never** decorative chrome. If a 3D element doesn't carry meaning (showing the machine's work, the mascot's life, the repo's structure), it doesn't ship.

**Tooling note:** the `website-builder-setup` skill the user mentioned bundles 21st.dev components and a preset library. Those presets will pull Mendel back toward generic SaaS — **do not use them for primary components.** Framer Motion (already in stack) and the `frontend-design` skill are the right tools.

**[Rev 2 reconciliation — supersedes the "R3F" wording above]:**
- **3D uses vanilla Three.js, not R3F.** `@react-three/fiber` v8 targets React 18 and breaks under this project's React 19 (discovered in Phase D / D2); `three` is React-agnostic and works. v2 **codifies vanilla Three.js** — an R3F v9 migration is pure risk with no user benefit. Where §9 above says "R3F," read "vanilla Three.js."
- **The S4 dependency graph is the functional 2D `<DepGraph>`, not a decorative 3D object.** Phase D / D4 replaced the decorative wireframe icosahedrons with a real, interactive 2D graph (real dep nodes, color-coded by state, hover tooltips, filter chips, click-to-expand the matching issue card) per the new CLAUDE.md §7.2a step 5 ("no decorative-only data viz on primary screens"). v2 extends it (F21 package clustering, F23 language-aware tooltips) — never reverts to decoration. The S1 hero 3D moment (item 1 above) remains the place for purely-atmospheric 3D.

---

## 10. Screen Architecture — Hybrid

**Decision:** S5 (issues), S6 (fix detail), S7 (PR confirm) are no longer separate routed screens. They become **inline states inside S4 (Live Console)** + **permalink routes that render the same components in a static post-hoc layout**.

**Live flow (during a scan):**

```
User pastes repo URL → S3 → submit → navigate to /scan/[id] (S4 Live Console)
  ↓
S4 streams: issues appear in center pane with confidence badges (was S5)
  ↓
User clicks an issue → expands in place: diagnosis + diff + "Not Analyzed" callout (was S6)
  ↓
User clicks "Open Draft PR" → inline confirmation state with GitHub link (was S7)
```

**Permalink flow (post-hoc / shareable):**

```
/scan/[id]              → S4 Live Console in "playback" mode (no streaming, all data static)
/scan/[id]/issue/[id]   → Issue detail (was S6) as a standalone route, reuses same components
/scan/[id]/pr/[id]      → PR confirmation (was S7) — useful for case-study links
```

**Why hybrid:** keeps the cinematic running-mode drama intact (one screen, continuous flow), AND gives shareable URLs per fix for the portfolio case study.

---

## 11. Per-Screen Briefs

Each brief is the minimum spec. Detailed component-level specs come in iteration 2 of this doc.

### S1 — Landing / Boot Sequence

- **Purpose:** Convince the visitor Mendel is a real, considered piece of equipment. Establish the world.
- **Mode:** Boot.
- **Layout:** Single full-bleed dark canvas. Top-left wordmark, top-right "v1.0-BETA" + Launch App CTA. Hero center: mascot + 3D wireframe machine. Below mascot: type-on tagline. Bottom: confidence framing band ("V1.0 · ALL PRS OPEN AS DRAFTS · CONFIDENCE: MEDIUM · MANUAL REVIEW REQUIRED").
- **Motion:** Full boot sequence (see §7). User can interact only after boot completes (~3.5s). Cursor in scroll-position triggers a parallax-style reveal of the "What it does" section.
- **Must-have:** the mascot's first appearance is the visual payoff. If the visitor doesn't feel "oh, this is a *thing*" within 4 seconds, the screen fails.
- **Routes:** `/`

### S2 — PAT Entry Modal

- **Purpose:** Capture GitHub PAT with maximum trust.
- **Mode:** Rest (it's a transactional moment, not a hero moment).
- **Layout:** Centered modal over dimmed canvas. Mascot in "waiting" pose at modal top (small, not hero size). Title "Connect GitHub". PAT input. Required scopes as a labeled mini-table. "Connect" CTA in phosphor. Link to generate token on GitHub.
- **Motion:** Modal slides up + scales from 0.96 to 1 over 280ms. Backdrop opacity 0 to 0.7 over same duration. PAT input has subtle phosphor focus ring.
- **Must-have:** "Token stored only in session" copy visible — trust signal. Current implementation has this; keep it.
- **Routes:** modal overlay, no route change.

### S3 — New Scan

- **Purpose:** Single-input screen to start a scan.
- **Mode:** Rest.
- **Layout:** Centered. Title "Scan a Repository". One-line description. Large URL input + Scan button (phosphor). Constraints panel below the input — bordered, slightly inset, lists v1.0 limits.
- **Motion:** Input focus ring pulses subtly. Scan button hover lifts 1px + glow intensifies. On submit: input collapses, button morphs into a loading state ("INITIALIZING…") for 600ms, then navigate to S4.
- **Must-have:** the constraints panel must look like a real warning panel (bordered, faint amber), not decorative text. Current implementation has flat text — fix.
- **Routes:** `/scan/new`

### S4 — Live Agent Console *(absorbs S5, S6, S7)*

- **Purpose:** Show the machine working. This is the product's signature screen.
- **Mode:** Running.
- **Layout:** Three columns.
    - **Left pane (240px):** Mascot in current pose, current state label, current substate ticker, mini stats (deps scanned, issues found).
    - **Center pane (flex):** Streaming reasoning log + issue cards as they're detected. Each issue card is collapsible — collapsed = one-line summary with confidence badge; expanded = diagnosis + diff + Not Analyzed callout + Open Draft PR button. Stage lane visualization above the log (SCAN → DIAGNOSE → PATCH → VERIFY, pills move between lanes as work progresses).
    - **Right pane (360px):** 3D wireframe dependency graph. Nodes pulse when analysis touches them.
- **Bottom command bar:** F-key style hints ("F1 PAUSE · F2 CANCEL · F3 INSPECT · F7 EXPORT"). Decorative + functional.
- **Motion:** Continuous. Particles drifting in background at low opacity. Status LEDs pulsing. Stage pills sliding. Type-on for new log lines. Mascot reacts to each phase change.
- **Must-have:** every PRD-spec phase (SCANNING / DIAGNOSING / PATCHING / VERIFYING / DONE) must produce visible motion in all three panes simultaneously. If you can't tell from a 5-second glance that the machine is working, the screen fails.
- **Routes:** `/scan/[id]` (live + playback)

### S5 — Issues List *(now inline in S4 + permalink view)*

- **Purpose:** Show all issues found in a scan, with confidence badges.
- **In S4 (live):** Cards stream into the center pane as detected.
- **Permalink (`/scan/[id]`, after completion):** Same cards, static, all visible at once. No streaming. Mascot in "idle/success" pose. Stage lane shows final state.
- **Must-have:** confidence badge per card. v1.0 = all amber. v1.5 = lime/amber/danger by bucket.

### S6 — Fix Detail *(inline expansion + permalink)*

- **Purpose:** Diagnosis + diff + Not Analyzed disclosure. This is where the calibrated-confidence thesis lives.
- **Layout (inline expanded card OR `/scan/[id]/issue/[id]`):**
    - Header: dep name + version diff + confidence badge
    - "What / Why / Evidence" structured block
    - File diff (syntax-highlighted, monospace, line numbers)
    - **"NOT ANALYZED" callout** — bordered amber panel, explicitly listing what wasn't checked. Never collapsed, never hidden, never below the fold.
    - "Open Draft PR" CTA + "Reject" secondary
- **Motion:** Expand animation pushes card height open over 320ms ease-out. Diff lines stagger-fade in 20ms per line.
- **Must-have:** the Not Analyzed callout must be visually loud. This is the trust mechanism — if it's quiet, the entire positioning fails.

### S7 — PR Confirmation *(inline + permalink)*

- **Purpose:** Confirm a real PR was opened, surface the GitHub URL.
- **Inline (in S4):** After Open Draft PR clicked, the issue card morphs — diff collapses, success state appears with PR URL + "View on GitHub" CTA + mascot success-state burst in left pane.
- **Permalink (`/scan/[id]/pr/[id]`):** Same content as a standalone route, useful for case study links.
- **Motion:** Card morph 380ms. Mascot success burst (lime ring expands, fades, 800ms total).

### S8 — Dashboard / Scan History

- **Purpose:** Returning users see past scans, PRs opened, system stats.
- **Mode:** Rest (Nixtio-dense readout).
- **Layout:** Top hero strip with 4 stat cards (PRs Opened, PRs Merged, Issues Found, Time Saved) — Nixtio-style bold numbers + small label + sparkline. Below: scan history table (current implementation is fine structurally, needs density + Nixtio styling). Right rail: most-recent-scan summary.
- **Motion:** Numbers tick up on first load (counting animation, 800ms). Sparklines draw in 600ms. Row hover lift.
- **Must-have:** must NOT look like the current empty Settings page. Density is the differentiator. Use real or fake data to fill it — empty dashboards betray the product.
- **Routes:** `/dashboard`

### S9 — Settings

- **Purpose:** Manage PAT, API keys, preferences.
- **Mode:** Rest.
- **Layout:** Sections as bordered panels. PAT section at top with status pill (ACTIVE/REVOKED), token input, save/revoke buttons. About panel below (current implementation is fine — keep). Add toggles section: reduce-motion, mascot, sound (v1.5).
- **Motion:** Minimal. Save button success state (200ms lime fill from left to right, then settle).
- **Routes:** `/settings`
- **[v2] Adds three panels** (same bordered-PanelFrame chrome, no new template): **Auto-Merge** (per-repo list, toggles default-OFF + visibly so, a loud honest disclosure of the §5c envelope — this is the trust surface, treat it like the v1.0 confidence banner); **Sandbox/Language** (read-only: which languages + analyzers are available); **MCP Server** (status + a copyable client-config snippet — copy buttons must work, §7.2a). All rest mode, no mascot.

---

## 11b. Per-Screen Briefs — v2 (Rev 2)

New surfaces obey the existing 3-mode map and anti-references. **Reuse before build** is the rule — these compose existing components.

### S10 — API Inspector ("Point at any API", F22)

- **Purpose:** paste a package + version range → breaking-change report. No repo, no PR.
- **Mode:** Rest, with a brief running flourish during the ~1–2s analysis.
- **Layout:** input row (package name + from/to version, npm autocomplete). Result reuses `<IssueCard context="rest">` + `<NotAnalyzedCallout>` + `<DiffViewer>` + `<ConfidenceBadge>` **verbatim** — identical visual language to a scan issue, zero new card design.
- **Motion:** mascot does a short scanning→thinking beat (reused poses), then settles. Not a full S4.
- **Must-have:** the report is **loud about what it didn't do** ("no repo context — affected-sites skipped; confidence capped at medium"). Confidence is structurally capped — never "high" (analogous to v1.0 amber-only).
- **Routes:** `/inspect`, permalink `/inspect/[id]`.

### S11 — Watchlist (Continuous Monitoring, F25)

- **Purpose:** manage repos scanned on a schedule by the local monitor worker.
- **Mode:** Rest (Nixtio-dense — anti-ref: no empty canvas).
- **Layout:** dense table — repo · schedule (human "every 6h") · last result (status dot + issues) · next run (relative, tabular-nums) · enable toggle · auto-merge indicator. Header reuses `<StatCard>` row + dashboard table styling. Add/edit row = cron-or-preset picker.
- **Mascot:** the new **"watching" pose** (§8) in the monitoring-active state. One instance only.
- **Motion:** rest-mode idle life; the watching sweep is a slow idle loop (reduced-motion → static); countdowns use number-flicker-on-update (§7).
- **Must-have:** honest scheduling disclosure — "runs only while your machine + the monitor process are up" (no false always-on promise; that's v3).
- **Routes:** `/watchlist`. Dashboard (S8) also gains a small "Monitoring" strip (repos watched, next-scan countdown, recent autonomous activity).

### S12 — Eval Report (F19, dev-only)

- **Purpose:** render the latest eval-bench report — the portfolio's strongest data artifact.
- **Mode:** Rest. **Dev-only** (`/dev/eval`), not in the authed app nav.
- **Layout:** Nixtio stat cards (precision/recall, calibration accuracy) + a calibration scatter (predicted bucket vs. actual correctness) via the existing sparkline/Framer technique. Reuses `<StatCard>` + `<PanelFrame>`. No mascot (dev surface).
- **Must-have:** genuinely-wired real data (§7.2a step 5) — not decoration.

### v2 changes to existing screens (no new routes)

- **S4 (Live Console):** StageLane 5th lane (SMOKE); issue cards gain a `<LangBadge>` + a `pkg:` chip (monorepo); the smoke result renders as a sub-panel in the expanded card; auto-merge adds an "AUTO-MERGED ✓" terminal state (phosphor + merge SHA) and a cancelable "auto-merge pending (Xs)" amber state with a **working** cancel control (§7.2a). `<DepGraph>` gains package clustering + language-aware tooltips.
- **S8 (Dashboard):** new "Auto-Merged" stat card; CalibrationSnapshot gains an auto-merge slice; the Monitoring strip.
- **S3 (New Scan):** after URL parse, an honest detected-context line (language · analyzer · "monorepo: N packages") in the constraints area.

---

## 11c. Per-Screen Briefs — v3 (Cloud)

Multi-tenant cloud surfaces. **Reuse before build** still binds — these compose existing components; the cyberpunk-CRT system, Bones (no new poses), tokens, and motion are unchanged. Each gets a `/dev/[component]` build-in-isolation + §14 workflow + the §7.2 step-6 spec audit before "done." Full context: V3_PLAN.md §6.

### S0 — Sign in with GitHub (F27)

- **Purpose:** the one pre-app gate. Replaces the local PAT paste.
- **Mode:** Boot (the most reductive — one action, one mascot, scan-line sweep on enter).
- **Layout:** single centered `<PanelFrame>` over `<ScanlineOverlay>`; Bones idle; one lime "Sign in with GitHub" button (the only primary action); below it, **honest scope-disclosure copy** ("Mendel requests `repo` + `read:user`. Your token is encrypted at rest and never shown back to you or any other user."). No password field (OAuth only). No marketing clutter — this is a gate, not a landing.
- **Must-have:** the scope copy is real, not lorem; the button is wired (§7.2a dead-control rule); error state ("GitHub sign-in failed — try again") is generic, never a stack trace.
- **Route:** `/signin`.

### S13 — Account / Tenant (F27/F32)

- **Purpose:** the user's identity + connected GitHub + runner tokens + danger-zone.
- **Mode:** Rest. **Nixtio-density — not 80% empty** (the anti-reference still binds).
- **Layout:** two-column. Left: identity card (GitHub avatar/login, connected scopes, "encrypted, never shown" PAT status pill — same `<StatusPill>` as Settings). Right: **Runner Tokens** panel (create/revoke tenant-scoped runner tokens for `pnpm runner`, F32 — each shows last-used, a working revoke button) + **Danger Zone** (delete account → cascades all your data; a real confirm, real handler).
- **Must-have:** every control wired; the danger-zone delete is genuinely destructive + confirmed (§10 destructive-op rule); token values shown **once** on creation, then masked forever.
- **Route:** `/account`.

### S14 — Runner Status (F32)

- **Purpose:** "is your local runner connected?" + setup copy. Honest about where compute happens.
- **Mode:** Rest with a live status pulse.
- **Layout:** a prominent live indicator with three honest states — **connected** (lime phosphor, "your machine is running scans"), **disconnected** (amber, "start `pnpm runner` to enable full scans"), **scan-in-flight** (cyan, animated, "running <repo> on your machine"). Below: the `pnpm runner` setup command block + a one-line explanation that compute runs on the user's machine (free) until hosted sandbox lands.
- **Must-have:** the status reflects **real** runner heartbeat data (§7.2a decorative-data rule — wired to the actual queue/runner state, not a fake light).
- **Route:** `/runner` (or a strip in S13).

### v3 changes to existing screens (no new routes)

- **All authed screens:** a tenant header chip (GitHub login + avatar) in the existing chrome; otherwise unchanged (they were built tenant-agnostic).
- **S10 (Inspector):** when public/unauthed in the cloud, a subtle "sign in to scan a repo" affordance — but `/inspect` itself works without login (the free demo). Rate-limit-hit state shows an honest "slow down — try again in a moment" (429), not a crash.

---

## 12. Component Inventory

Components to build for Phase D. Each gets its own spec file under `/components/` once we move to build.

| Component | Used in |
| --- | --- |
| `<PanelFrame>` | Wraps every major UI block. Border, slight inset, optional title bar. The TE-feel chrome. |
| `<ConfidenceBadge>` | Confidence label with color + level. Amber default. |
| `<StatusPill>` | Phase/state pill — SCANNING, DIAGNOSING, etc. Used in S4 stage lanes and bottom bar. |
| `<MascotWidget>` | Mascot in current pose + state label. Sidebar variant + hero variant. |
| `<StageLane>` | The SCAN → DIAGNOSE → PATCH → VERIFY visualization with pills moving between. |
| `<IssueCard>` | Collapsible card with confidence badge. Lives in S4 stream + permalink list. |
| `<NotAnalyzedCallout>` | Loud amber panel, bulleted list of unchecked items. |
| `<DiffViewer>` | Syntax-highlighted file diff. Monospace, line numbers, copy button. |
| `<TerminalLog>` | Streaming log lines with type-on animation. |
| `<DepGraph3D>` | R3F wireframe dependency graph. Right pane of S4. |
| `<StatCard>` | Big number + label + sparkline. Nixtio-density. Dashboard. |
| `<CommandBar>` | F-key hint bar at bottom of S4. |
| `<ScanlineOverlay>` | Page-level subtle scanline drift. |
| `<BootSequence>` | S1-only choreography orchestrator. |

**[v2] New components (everything else reuses the above):**

| Component | Used in |
| --- | --- |
| `<LangBadge>` | Tiny mono label chip — TS / PY / GO / RS. Uses existing cyan-chrome accent + `label` type token; **no new colors**. On issue cards, S4 left pane, dashboard rows. |
| `<SmokeResultPanel>` | Bordered sub-panel inside the issue card's expanded body (under Verification Results). Phosphor when booted, amber when not-attempted/inconclusive, danger when crashed; wraps a `<TerminalLog context="rest">` for the `logTail`. Honest: never a fake green. |

Everything F22/F24/F25/F26 needs beyond these is a **composition of existing components** (PanelFrame, StatCard, StatusPill, IssueCard, ConfidenceBadge, DepGraph, table chrome). Each new component + changed screen gets a `/dev/[component]` isolation pass before integration (CLAUDE.md §6b).

### 12.1 Dual-mode behavior (added 2026-05-20 — Phase D readiness review)

Three components render in two mode contexts depending on where they appear:

| Component | `context="running"` (inline in S4) | `context="rest"` (permalink routes, post-hoc) |
| --- | --- | --- |
| `<IssueCard>` | Glow active on confidence badge. Type-on for new card entry. Particle drift in card background at 0.2 opacity. Status LED pulse on left border tied to current phase. | Flat fill. No glow. No particles. No animated border. Hover lift only (1px, 120ms ease-out). |
| `<NotAnalyzedCallout>` | Amber border pulses subtly (2s loop). Bullet items stagger-fade in 40ms apart. | Static amber border, no pulse. All bullets visible immediately. |
| `<DiffViewer>` | Lines stagger-fade in 20ms each on first reveal. Cursor blink on the active hunk. | All lines visible immediately. No cursor. |

Each takes a required `context: 'running' | 'rest'` prop. Default `'rest'` if not specified (safer fallback — missing context should not produce running-mode noise). Components must NOT infer context from URL or runtime state — pass explicitly from parent.

**Single-context components:**

- `<StageLane>`, `<CommandBar>` — running-only. No rest variant; in permalink views these don't render (the scan is over; stages don't move).
- `<DepGraph3D>` — both contexts. Running: nodes pulse when touched by analysis. Rest: static positions with hover-only highlights.
- `<MascotWidget>` — both contexts. In rest, pose stays frozen at the scan's final state (idle/success/failure); no live-streaming pose changes.
- `<TerminalLog>`, `<BootSequence>` — running-only by nature.
- `<PanelFrame>`, `<ConfidenceBadge>`, `<StatusPill>`, `<StatCard>`, `<ScanlineOverlay>` — mode-agnostic (look the same in both contexts).

This spec is mandatory reading before D3 opens. The mode contracts are how the same components avoid feeling alive in the permalink views (where they should feel post-hoc, archival, dense).

---

## 13. Anti-References (what NOT to do)

Specifically calling out the current AI-slop so it doesn't regress:

- ❌ Massive empty black space with one small form floating in the middle (current Settings, current New Scan, current Live Console). **Fix:** Nixtio-density on every rest-mode screen. If the screen is 80% empty, it's wrong.
- ❌ Same H1 + subtitle template on every screen (current Settings / Scan History / New Scan). **Fix:** each mode has its own header treatment. Boot mode has no header, running has a status strip, rest has a Nixtio stat row.
- ❌ Mascot duplicated 2–3 times per screen with no behavior difference (current sidebar + content + sometimes header, all "IDLE"). **Fix:** mascot appears once per screen unless it's S1 (hero + sidebar = one is the "you" view, one is the "him" view).
- ❌ Default shadcn-feeling inputs and buttons. **Fix:** every input wrapped in PanelFrame chrome, every button has a TE-style border-and-glow press state.
- ❌ Dropping the cyberpunk-CRT brief at execution time (one scanline on the wordmark and nothing else). **Fix:** ScanlineOverlay is page-level. CRT curvature optional on S1 only. ASCII section dividers in dense screens.
- ❌ Generic 21st.dev / preset components used as-is (the `website-builder-setup` skill). **Fix:** Framer Motion + R3F + `frontend-design` skill + custom components only.
- ❌ Mascot speaking, captioning, or explaining. He's a character, not a chatbot. **Fix:** reactions only, no words.

---

## 14. Design Workflow Protocol

**Mandatory before any UI component is written or modified:**

1. Load the `frontend-design` skill (Claude Code's built-in design skill).
2. Read this [DESIGN.md](http://design.md/) in full.
3. Read the relevant per-screen brief (§11).
4. Read the relevant component spec (§12) if it exists, or create one as part of the work.
5. Build the component in isolation first (Storybook or a `/dev` route).
6. Manual walk-through by PM before declaring done (per [CLAUDE.md](http://claude.md/) §7).
7. Update this [DESIGN.md](http://design.md/) if any decision was made that wasn't documented.

**Iteration loop:** every screen goes through at least two design review rounds before code-freeze. Round 1 = "does it match the brief?" Round 2 = "does it feel right?"

---

## 15. Open Questions

| # | Question | Answer / Decision | Status |
| --- | --- | --- | --- |
| 1 | Mascot name? | **Bones** | ✅ Resolved |
| 2 | Mascot tooling — Rive 2D vs low-poly 3D in R3F? | **Rive 2D** | ✅ Resolved 2026-05-20 |
| 3 | Does the 3D dep graph need real dep data or is mock acceptable for v1.0? | Real dep data | ✅ Resolved |
| 4 | Sound design — v1.5 or v2? | v2 (defer until after v1.5 ships) | ✅ Resolved |
| 5 | Reference screenshots from the .mov recordings | TBD (not blocking but will sharpen motion specs) | ⏳ Needed before final motion review |