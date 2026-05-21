'use client'

/**
 * MascotWidget — "Bones", the operator of the Mendel machine.
 *
 * Phase D component (DESIGN.md §8, §12). Bones reacts to the agent's phase;
 * he never speaks (DESIGN.md §8 anti-rule).
 *
 * ── ABSTRACTION BOUNDARY ──────────────────────────────────────────────────────
 * Every screen consumes ONLY this interface:  <MascotWidget pose={...} />
 * The implementation behind it is swappable. Right now it renders an on-brand
 * PLACEHOLDER. The real mascot (a 3D model the owner is building) drops in here
 * later — likely an R3F <Canvas> loading a .glb, mapping `pose` → animation clip.
 * Nothing else in the app changes when that happens; this file is the only edit.
 *
 * History: §15 Q2 originally locked Rive 2D, but Rive requires drawing+rigging
 * skills incompatible with a no-cost solo project. Pivoted to a 3D model
 * (owner-supplied). Rive dependency removed 2026-05-21. See STATE.md.
 * ──────────────────────────────────────────────────────────────────────────────
 */

// ── Pose taxonomy (DESIGN.md §8, minus the v1.5-gated `uncertain`) ────────────
// 9 states. `uncertain` is intentionally excluded until v1.5 unpauses; adding it
// is a one-line change to this union + MASCOT_POSES and won't break callers.
export type MascotPose =
  | 'idle'
  | 'scanning'
  | 'thinking'
  | 'detecting'
  | 'patching'
  | 'verifying'
  | 'success'
  | 'failure'
  | 'error'

/** All poses, idle first. Single source of truth for iteration (dev preview, tests). */
export const MASCOT_POSES: MascotPose[] = [
  'idle',
  'scanning',
  'thinking',
  'detecting',
  'patching',
  'verifying',
  'success',
  'failure',
  'error',
]

interface MascotWidgetProps {
  /** Current pose. Defaults to idle. */
  pose?: MascotPose
  /** Square render size in px. */
  size?: number
  className?: string
}

export function MascotWidget({ pose = 'idle', size = 200, className }: MascotWidgetProps) {
  return <MascotPlaceholder pose={pose} size={size} className={className} />
}

// ── Placeholder ───────────────────────────────────────────────────────────────
// On-brand stand-in until the 3D model is wired. Cyberpunk-CRT, not a spinner
// (DESIGN.md anti-pattern: "loading states narrate"). Confirms the pose prop
// flows through correctly so D2 screens can integrate against it today.
function MascotPlaceholder({
  pose,
  size,
  className,
}: {
  pose: MascotPose
  size: number
  className?: string
}) {
  return (
    <div
      className={className}
      data-mascot-pose={pose}
      data-mascot-status="placeholder"
      style={{
        width: size,
        height: size,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        background:
          'repeating-linear-gradient(0deg, #0A0A0A, #0A0A0A 2px, #111111 2px, #111111 4px)',
        border: '1px solid var(--border-strong, rgba(255,255,255,0.12))',
        color: '#C6FF3D',
        fontFamily: 'var(--font-display, "JetBrains Mono", monospace)',
        textAlign: 'center',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: '0.625rem', letterSpacing: '0.2em', color: '#555555' }}>
        BONES
      </span>
      <span
        style={{
          fontSize: '0.875rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          textShadow: '0 0 12px rgba(198,255,61,0.45)',
        }}
      >
        {pose}
      </span>
      <span style={{ fontSize: '0.5rem', letterSpacing: '0.15em', color: '#FFB84D' }}>
        3d model pending
      </span>
    </div>
  )
}
