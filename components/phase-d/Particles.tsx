'use client'

/**
 * Particles — ambient drifting motes for the S4 background (DESIGN.md §11 S4
 * "Motion: Continuous. Particles drifting in background at low opacity").
 *
 * Implementation choices:
 *   - Pure SVG + Framer Motion (no canvas, no extra deps).
 *   - Each particle has a deterministic seed so SSR/CSR markup matches
 *     (avoids React hydration warnings from Math.random()).
 *   - Disabled entirely on `prefers-reduced-motion`. Hidden on pointer devices
 *     when context === 'rest' (settled scans don't need ambient motion).
 *   - pointer-events: none — never intercepts clicks on underlying UI.
 *   - z-index 0 — sits above the bg-0 fill but below all panes.
 */

import { useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

interface ParticlesProps {
  /** How many particles. ~24 reads as "ambient" without dominating. */
  count?: number
  /** Hide entirely when context is rest (settled scan). */
  context?: 'running' | 'rest'
  /** Color hex. Defaults to the phosphor accent at low alpha. */
  color?: string
}

interface Particle {
  cx: number       // 0..100 (%)
  cy: number       // 0..100 (%)
  r: number        // px
  delay: number    // s
  duration: number // s, drift cycle
  driftX: number   // px
  driftY: number   // px
}

/**
 * Mulberry32 seeded PRNG → deterministic particle field across SSR/CSR.
 */
function seedRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeField(count: number): Particle[] {
  const rng = seedRandom(0xC0FFEE)
  return Array.from({ length: count }, () => ({
    cx: rng() * 100,
    cy: rng() * 100,
    r: 0.5 + rng() * 1.5,
    delay: rng() * 6,
    duration: 8 + rng() * 8,
    driftX: (rng() - 0.5) * 60,
    driftY: (rng() - 0.5) * 40,
  }))
}

export function Particles({ count = 28, context = 'running', color = '#C6FF3D' }: ParticlesProps) {
  const reduced = useReducedMotion()
  // Rest mode gets a quieter field — half the count, dimmer alpha. DESIGN.md
  // §11 S4 calls for "continuous particles drifting" — that's all the time,
  // not just during running. Settled is just calmer, not absent.
  const restMode = context === 'rest'
  const effectiveCount = restMode ? Math.floor(count / 2) : count
  const peakAlpha = restMode ? 0.18 : 0.35
  const particles = useMemo(() => makeField(effectiveCount), [effectiveCount])
  if (reduced) return null
  return (
    <svg
      aria-hidden
      data-component="particles"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      {particles.map((p, i) => (
        <motion.circle
          key={i}
          cx={`${p.cx}%`}
          cy={`${p.cy}%`}
          r={p.r}
          fill={color}
          initial={{ opacity: 0 }}
          animate={{
            opacity: [0, peakAlpha, peakAlpha, 0],
            x: [0, p.driftX, p.driftX * 0.7, 0],
            y: [0, p.driftY, p.driftY * 0.5, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </svg>
  )
}
