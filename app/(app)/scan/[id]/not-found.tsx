import Link from 'next/link'

/**
 * Fix #8 — /scan/[id] not-found. Triggered when the API returns 404.
 */
export default function ScanNotFound() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.25rem', padding: '3rem 2rem' }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-warning)' }}>
        404 · Scan not on record
      </p>
      <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
        We can&apos;t find that scan.
      </h1>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', textAlign: 'center', maxWidth: '420px' }}>
        It may have been pruned, the URL may be wrong, or the scan never ran. Start a new one or check your history.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <Link href="/scan/new" className="btn-primary">Start a new scan →</Link>
        <Link href="/dashboard" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', textDecoration: 'none', alignSelf: 'center' }}>
          ← Dashboard
        </Link>
      </div>
    </div>
  )
}
