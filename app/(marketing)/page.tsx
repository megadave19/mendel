'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Skull } from '@/components/mascot/skull'
import { CRTOverlay } from '@/components/shared/crt-overlay'

const FEATURES = [
  { label: 'Detects', value: 'Stale deps + breaking changes' },
  { label: 'Generates', value: 'Migration patches via LLM' },
  { label: 'Verifies', value: 'Isolated Docker sandbox' },
  { label: 'Opens', value: 'Draft PRs with confidence score' },
]

export default function LandingPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg-0)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <CRTOverlay />

      {/* Background grid */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(198,255,61,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(198,255,61,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
        }}
      />

      {/* Top bar */}
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Skull state="idle" size={28} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: '0.875rem',
            letterSpacing: '0.1em',
            color: 'var(--accent-primary)',
          }}>
            MENDEL
          </span>
        </div>

        <nav style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.625rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            v1.0-beta
          </span>
          <Link href="/connect" className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.625rem' }}>
            Launch App →
          </Link>
        </nav>
      </motion.header>

      {/* Hero */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4rem 2rem',
        position: 'relative',
        zIndex: 10,
        textAlign: 'center',
      }}>
        {/* Skull mascot */}
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: '2.5rem' }}
        >
          <Skull state="idle" size={120} showLabel />
        </motion.div>

        {/* Label */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.625rem',
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: 'var(--accent-warning)',
            marginBottom: '1.5rem',
          }}
        >
          Autonomous OSS Maintenance Agent
        </motion.p>

        {/* Big headline */}
        <motion.h1
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="glitch-text"
          data-text="MENDEL"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'clamp(5rem, 18vw, 11rem)',
            fontWeight: 700,
            lineHeight: 0.9,
            letterSpacing: '-0.03em',
            color: 'var(--text-primary)',
            marginBottom: '2rem',
          }}
        >
          MENDEL
        </motion.h1>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.7 }}
          style={{
            fontSize: 'clamp(1rem, 2.5vw, 1.25rem)',
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            maxWidth: '560px',
            marginBottom: '0.75rem',
          }}
        >
          Stale deps. Breaking changes. Migration patches.
          <br />
          Draft PRs with honest confidence scores.
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          style={{
            fontSize: '0.8125rem',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            maxWidth: '440px',
            marginBottom: '3rem',
          }}
        >
          Built for OSS maintainers tired of manual migration work.
          No webhooks. No SaaS. Just a GitHub PAT and a scan.
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}
        >
          <Link href="/connect" className="btn-primary">
            Connect GitHub →
          </Link>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.625rem',
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
          }}>
            Uses a Personal Access Token · No OAuth
          </span>
        </motion.div>

        {/* Feature grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.8 }}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '1px',
            marginTop: '5rem',
            background: 'var(--border-subtle)',
            border: '1px solid var(--border-subtle)',
            maxWidth: '700px',
            width: '100%',
          }}
        >
          {FEATURES.map(({ label, value }) => (
            <div
              key={label}
              style={{
                background: 'var(--bg-1)',
                padding: '1.25rem 1rem',
                textAlign: 'center',
              }}
            >
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.5625rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--accent-primary)',
                marginBottom: '0.5rem',
              }}>{label}</p>
              <p style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}>{value}</p>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Confidence disclaimer — CLAUDE.md §5b */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 0.6 }}
        style={{
          position: 'fixed',
          bottom: '1.25rem',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 100,
          whiteSpace: 'nowrap',
        }}
      >
        <span className="confidence-badge">
          v1.0 · All PRs open as Drafts · Confidence: medium · Manual review required
        </span>
      </motion.div>
    </main>
  )
}
