'use client'

/**
 * S1 — Landing / Boot Sequence (DESIGN.md §11 S1).
 *
 * Reworked against the reference design language (2026-05-21): pure-black
 * infinite canvas, ONE isolated hero (the pixel skull assembling from a particle
 * cloud + wireframe ghost), corner HUD overlays (live ms timer, cycling state
 * word, pill labels), extreme type hierarchy (massive display vs 11px HUD), a
 * single glowing phosphor accent that bleeds from within. Motion is material:
 * the skull ASSEMBLES, it doesn't fade. The canvas never goes static.
 *
 * Mendel keeps its semantic palette (lime/amber/danger = confidence) rather than
 * the references' pink/purple — the reference *treatment* is applied to our color.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { PixelSkullHero } from '@/components/phase-d/PixelSkullHero'
import { ScanlineOverlay } from '@/components/phase-d/ScanlineOverlay'

const STATE_WORDS = ['BOOT', 'WAKE', 'CALIBRATE', 'ONLINE']

function fmtTimer(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const milli = Math.floor(ms % 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`
}

// HUD corner label — pill border, no fill, all-caps mono (reference HUD language).
function HudLabel({
  children,
  color = 'var(--text-secondary)',
  pill = true,
}: {
  children: React.ReactNode
  color?: string
  pill?: boolean
}) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.6875rem',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color,
        padding: pill ? '0.35rem 0.7rem' : 0,
        border: pill ? `1px solid ${color === 'var(--text-secondary)' ? 'var(--border-strong)' : color}` : 'none',
        borderRadius: pill ? '999px' : 0,
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {children}
    </span>
  )
}

export default function LandingPage() {
  const [stage, setStage] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [wordIdx, setWordIdx] = useState(0)

  // Boot stage gates.
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setStage(4)
      setWordIdx(STATE_WORDS.length - 1)
      return
    }
    const timers = [
      setTimeout(() => setStage(1), 100), // HUD corners stagger in
      setTimeout(() => setStage(2), 500), // skull assembly begins
      setTimeout(() => setStage(3), 2400), // display text
      setTimeout(() => setStage(4), 3200), // interactive
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  // Live millisecond timer (reference HUD: 00:12.718).
  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - start), 37)
    return () => clearInterval(id)
  }, [])

  // Cycling state word, settles on ONLINE.
  useEffect(() => {
    if (stage >= 4) {
      setWordIdx(STATE_WORDS.length - 1)
      return
    }
    const id = setInterval(() => setWordIdx((i) => Math.min(i + 1, STATE_WORDS.length - 1)), 700)
    return () => clearInterval(id)
  }, [stage])

  const fadeIn = (show: boolean, delay = 0) => ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: show ? 1 : 0, y: show ? 0 : 8 },
    transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
  })

  return (
    <main
      style={{
        position: 'relative',
        minHeight: '100vh',
        background: 'var(--bg-0)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ScanlineOverlay intensity={stage >= 2 ? 'rest' : 'boot'} opacity={stage >= 2 ? 0.5 : 1} />

      {/* Faint radial vignette to deepen the infinite-black canvas */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse 60% 50% at 50% 45%, rgba(198,255,61,0.04), transparent 70%)',
        }}
      />

      {/* ── Corner HUD (reference signature: pinned utility labels) ── */}
      {/* Top-left: wordmark */}
      <motion.div {...fadeIn(stage >= 1)} style={{ position: 'fixed', top: '1.5rem', left: '1.5rem', zIndex: 20 }}>
        <HudLabel color="var(--accent-primary)">MENDEL // v1.0</HudLabel>
      </motion.div>

      {/* Top-right: cycling state word + launch */}
      <motion.div
        {...fadeIn(stage >= 1, 0.15)}
        style={{ position: 'fixed', top: '1.5rem', right: '1.5rem', zIndex: 20, display: 'flex', gap: '0.75rem', alignItems: 'center' }}
      >
        <HudLabel color="var(--accent-secondary)">{`◇ ${STATE_WORDS[wordIdx]}`}</HudLabel>
        <Link
          href="/connect"
          className="btn-primary"
          style={{ padding: '0.4rem 1rem', fontSize: '0.625rem', borderRadius: '999px', pointerEvents: stage >= 4 ? 'auto' : 'none', opacity: stage >= 4 ? 1 : 0.35 }}
        >
          Launch →
        </Link>
      </motion.div>

      {/* Bottom-left: live ms timer */}
      <motion.div {...fadeIn(stage >= 1, 0.3)} style={{ position: 'fixed', bottom: '1.5rem', left: '1.5rem', zIndex: 20 }}>
        <HudLabel pill={false} color="var(--text-muted)">{`UPTIME ${fmtTimer(elapsed)}`}</HudLabel>
      </motion.div>

      {/* Bottom-right: draft-only flag */}
      <motion.div {...fadeIn(stage >= 1, 0.45)} style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 20 }}>
        <HudLabel color="var(--accent-warning)">DRAFT-ONLY · CONF: MEDIUM</HudLabel>
      </motion.div>

      {/* ── The one hero: assembling pixel skull ── */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: stage >= 2 ? 1 : 0 }}
          transition={{ duration: 0.8 }}
        >
          <PixelSkullHero size={380} startDelay={0} />
        </motion.div>

        {/* Display line — appears after the skull lands */}
        <motion.h1
          {...fadeIn(stage >= 3)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'clamp(1.75rem, 4.5vw, 3.25rem)',
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--text-primary)',
            textAlign: 'center',
            marginTop: '-1.5rem',
            lineHeight: 1.05,
          }}
        >
          Stale deps in.
          <br />
          <span style={{ color: 'var(--accent-primary)', textShadow: 'var(--glow-primary)' }}>Draft PRs out.</span>
        </motion.h1>

        {/* Sub-line + CTA */}
        <motion.p
          {...fadeIn(stage >= 4, 0.1)}
          style={{ fontFamily: 'var(--font-sans)', fontSize: '0.9375rem', color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '440px', marginTop: '1.25rem', lineHeight: 1.6 }}
        >
          An autonomous agent that reads changelogs, writes migration patches, verifies
          them in a sandbox, and opens a Draft PR — honest about what it didn&apos;t check.
        </motion.p>

        <motion.div {...fadeIn(stage >= 4, 0.2)} style={{ marginTop: '2rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link href="/connect" className="btn-primary" style={{ pointerEvents: stage >= 4 ? 'auto' : 'none' }}>
            Connect GitHub →
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
            PAT · NO OAUTH · SESSION-ONLY
          </span>
        </motion.div>
      </div>
    </main>
  )
}
