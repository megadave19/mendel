'use client'

/**
 * Fix #8 — (app) error boundary. Catches runtime errors in any (app) route so
 * users see a styled, recoverable error screen instead of Next.js's dev overlay.
 */

import { useEffect } from 'react'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app] route error:', error)
  }, [error])

  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.25rem', padding: '3rem 2rem' }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-danger)' }}>
        Runtime error
      </p>
      <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
        Something broke.
      </h1>
      <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '640px', whiteSpace: 'pre-wrap', textAlign: 'center' }}>
        {error.message}
        {error.digest && `\n\nref: ${error.digest}`}
      </pre>
      <button onClick={reset} className="btn-primary">Try again</button>
    </div>
  )
}
