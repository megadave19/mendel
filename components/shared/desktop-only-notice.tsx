/**
 * Fix #1 (audit-2) — explicit desktop-only notice for viewports < 1024px.
 * Owner decision: Mendel is a desktop web app; no responsive/mobile work.
 * Instead of letting layouts break ugly, we set the expectation clearly.
 */

export function DesktopOnlyNotice() {
  return (
    <div className="desktop-only-notice" role="status">
      <div style={{ maxWidth: 360 }}>
        <p
          style={{
            fontSize: '0.5625rem',
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: 'var(--accent-warning)',
            marginBottom: '0.75rem',
          }}
        >
          Desktop only
        </p>
        <h2
          style={{
            fontSize: '1.25rem',
            fontWeight: 700,
            letterSpacing: '0.02em',
            marginBottom: '0.75rem',
            color: 'var(--accent-primary)',
          }}
        >
          Mendel is built for desktop.
        </h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Please widen this browser window to at least <strong>1024px</strong>, or open
          Mendel on a desktop. The live agent console + 3D dep graph need the room.
        </p>
      </div>
    </div>
  )
}
