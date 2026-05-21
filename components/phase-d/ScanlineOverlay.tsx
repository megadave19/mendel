'use client'

/**
 * ScanlineOverlay — page-level CRT atmosphere (DESIGN.md §12, §13 anti-ref fix).
 * Mode-agnostic. Fixed, pointer-events-none, sits above content but below modals.
 *
 * `intensity="boot"` raises the scanline noise for the S1 power-on beat
 * (DESIGN.md §7: noise fades 0.4 → 0.08 over 1200ms — caller animates opacity).
 */

interface ScanlineOverlayProps {
  /** boot = stronger noise for S1 power-on; rest = subtle always-on hum. */
  intensity?: 'boot' | 'rest'
  /** Overlay opacity 0..1, for boot fade-in choreography. Default 1. */
  opacity?: number
}

export function ScanlineOverlay({ intensity = 'rest', opacity = 1 }: ScanlineOverlayProps) {
  return (
    <div aria-hidden style={{ opacity, transition: 'opacity 400ms ease-out' }}>
      <div className="crt-overlay" />
      <div className="crt-vignette" />
      <div className="crt-scanline" />
      {intensity === 'boot' && (
        <div
          style={{
            pointerEvents: 'none',
            position: 'fixed',
            inset: 0,
            zIndex: 9996,
            mixBlendMode: 'overlay',
            background:
              'repeating-linear-gradient(0deg, rgba(198,255,61,0.03), rgba(198,255,61,0.03) 1px, transparent 1px, transparent 3px)',
          }}
        />
      )}
    </div>
  )
}
