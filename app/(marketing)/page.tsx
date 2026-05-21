'use client'

/**
 * S1 — Landing / Boot Sequence (DESIGN.md §11 S1). Boot mode.
 *
 * The visitor must feel "oh, this is a *thing*" within 4s. Choreographed power-on
 * per DESIGN.md §7 boot beats:
 *   CRT power-on (canvas scale 0.96→1 + scanline noise fade) → mascot phosphor warm
 *   → type-on wordmark (35ms/char) → headline drift-reveal → staggered corner labels
 *   → interactive (CTA, features, confidence band) at ~3.5s.
 *
 * The hero mascot is the MascotWidget placeholder until the 3D model lands; the
 * boot choreography is independent of which mascot implementation sits behind it.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { MascotWidget } from '@/components/MascotWidget'
import { ScanlineOverlay } from '@/components/phase-d/ScanlineOverlay'
import { useTypeOn } from '@/hooks/use-type-on'

const FEATURES = [
  { label: 'Detects', value: 'Stale deps + breaking changes' },
  { label: 'Generates', value: 'Migration patches via LLM' },
  { label: 'Verifies', value: 'Isolated Docker sandbox' },
  { label: 'Opens', value: 'Draft PRs with confidence score' },
]

// Boot stage gates (ms) — DESIGN.md §7.
const T_CANVAS = 0
const T_MASCOT = 600
const T_TYPE = 1500
const T_INTERACTIVE = 3300

export default function LandingPage() {
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setStage(4)
      return
    }
    const t1 = setTimeout(() => setStage(1), T_CANVAS + 50)
    const t2 = setTimeout(() => setStage(2), T_MASCOT)
    const t3 = setTimeout(() => setStage(3), T_TYPE)
    const t4 = setTimeout(() => setStage(4), T_INTERACTIVE)
    return () => [t1, t2, t3, t4].forEach(clearTimeout)
  }, [])

  // Wordmark types on once we hit the type stage.
  const { shown: wordmark, done: wordmarkDone } = useTypeOn('MENDEL', 90, stage >= 3 ? 0 : 999999)

  return (
    <motion.main
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      style={{
        minHeight: '100vh',
        background: 'var(--bg-0)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* CRT power-on: scanline noise fades from boot-strong to rest-subtle */}
      <ScanlineOverlay intensity="boot" opacity={stage >= 2 ? 0.4 : 1} />

      {/* Background grid */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(rgba(198,255,61,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(198,255,61,0.03) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
        }}
      />

      {/* Top bar — corner labels stagger in (150ms apart, DESIGN.md §7) */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1.5rem 2.5rem',
          borderBottom: '1px solid var(--border-subtle)',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <motion.span
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: stage >= 1 ? 1 : 0, y: stage >= 1 ? 0 : -8 }}
          transition={{ duration: 0.5 }}
          style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.875rem', letterSpacing: '0.1em', color: 'var(--accent-primary)' }}
        >
          MENDEL
        </motion.span>
        <motion.nav
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: stage >= 1 ? 1 : 0, y: stage >= 1 ? 0 : -8 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            v1.0-beta
          </span>
          <Link
            href="/connect"
            className="btn-primary"
            style={{ padding: '0.5rem 1.25rem', fontSize: '0.625rem', pointerEvents: stage >= 4 ? 'auto' : 'none', opacity: stage >= 4 ? 1 : 0.4 }}
          >
            Launch App →
          </Link>
        </motion.nav>
      </header>

      {/* Hero */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '3rem 2rem',
          position: 'relative',
          zIndex: 10,
          textAlign: 'center',
        }}
      >
        {/* Mascot — phosphor warm: fades + glows up after silhouette */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8, filter: 'drop-shadow(0 0 0 rgba(198,255,61,0))' }}
          animate={{
            opacity: stage >= 2 ? 1 : 0,
            scale: stage >= 2 ? 1 : 0.8,
            filter: stage >= 2 ? 'drop-shadow(0 0 24px rgba(198,255,61,0.35))' : 'drop-shadow(0 0 0 rgba(198,255,61,0))',
          }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: '2.25rem' }}
        >
          <MascotWidget pose="idle" size={132} />
        </motion.div>

        {/* Tagline label */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: stage >= 3 ? 1 : 0 }}
          transition={{ duration: 0.5 }}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.25em', textTransform: 'uppercase', color: 'var(--accent-warning)', marginBottom: '1.25rem' }}
        >
          Autonomous OSS Maintenance Agent
        </motion.p>

        {/* Type-on wordmark → drift-reveal once complete */}
        <motion.h1
          animate={{ y: wordmarkDone ? 0 : 8 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'clamp(4.5rem, 16vw, 10rem)',
            fontWeight: 700,
            lineHeight: 0.9,
            letterSpacing: '-0.03em',
            color: 'var(--text-primary)',
            marginBottom: '1.75rem',
            minHeight: '1em',
          }}
        >
          {wordmark}
          {stage >= 3 && !wordmarkDone && <span className="terminal-cursor" style={{ height: '0.8em', width: '0.5em' }} />}
        </motion.h1>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: stage >= 4 ? 1 : 0, y: stage >= 4 ? 0 : 12 }}
          transition={{ duration: 0.6 }}
          style={{ fontSize: 'clamp(1rem, 2.5vw, 1.2rem)', lineHeight: 1.6, color: 'var(--text-secondary)', maxWidth: '560px', marginBottom: '2.5rem' }}
        >
          Stale deps. Breaking changes. Migration patches.
          <br />
          Draft PRs with honest confidence scores.
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: stage >= 4 ? 1 : 0, y: stage >= 4 ? 0 : 12 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}
        >
          <Link href="/connect" className="btn-primary" style={{ pointerEvents: stage >= 4 ? 'auto' : 'none' }}>
            Connect GitHub →
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
            Uses a Personal Access Token · No OAuth
          </span>
        </motion.div>

        {/* Feature grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: stage >= 4 ? 1 : 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '1px',
            marginTop: '4rem',
            background: 'var(--border-subtle)',
            border: '1px solid var(--border-subtle)',
            maxWidth: '720px',
            width: '100%',
          }}
        >
          {FEATURES.map(({ label, value }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: stage >= 4 ? 1 : 0, y: stage >= 4 ? 0 : 8 }}
              transition={{ duration: 0.4, delay: 0.3 + i * 0.08 }}
              style={{ background: 'var(--bg-1)', padding: '1.25rem 1rem', textAlign: 'center' }}
            >
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--accent-primary)', marginBottom: '0.5rem' }}>
                {label}
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{value}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* Confidence band — CLAUDE.md §5b */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: stage >= 4 ? 1 : 0 }}
        transition={{ duration: 0.6 }}
        style={{ position: 'fixed', bottom: '1.25rem', left: '50%', transform: 'translateX(-50%)', zIndex: 100, whiteSpace: 'nowrap' }}
      >
        <span className="confidence-badge">
          v1.0 · All PRs open as Drafts · Confidence: medium · Manual review required
        </span>
      </motion.div>
    </motion.main>
  )
}
