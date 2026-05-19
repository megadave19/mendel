export default function LandingPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        textAlign: 'center',
        background: 'var(--bg-0)',
      }}
    >
      {/* Hero */}
      <div style={{ maxWidth: '640px', width: '100%' }}>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.625rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--accent-warning)',
            marginBottom: '1.5rem',
          }}
        >
          Autonomous OSS Maintenance Agent
        </p>

        <h1
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'clamp(3rem, 10vw, 6rem)',
            fontWeight: 700,
            lineHeight: 1,
            color: 'var(--text-primary)',
            marginBottom: '1.5rem',
            letterSpacing: '-0.02em',
          }}
        >
          Mendel
        </h1>

        <p
          style={{
            fontSize: '1.125rem',
            lineHeight: 1.7,
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
          }}
        >
          Stale dependencies. Breaking changes. Patch generation.
          <br />
          Draft PRs with explicit confidence scoring.
        </p>

        <p
          style={{
            fontSize: '0.875rem',
            color: 'var(--text-muted)',
            marginBottom: '3rem',
          }}
        >
          Built for OSS maintainers who are tired of manual migration work.
        </p>

        {/* CTA — placeholder; wired up in Phase 1B */}
        <button type="button" className="btn-primary">
          Connect GitHub
        </button>

        <p
          style={{
            marginTop: '1rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Uses a GitHub Personal Access Token · No OAuth required
        </p>
      </div>

      {/* Persistent v1.0 confidence framing — CLAUDE.md §5b */}
      <div
        className="confidence-badge"
        style={{
          position: 'fixed',
          bottom: '1.5rem',
          left: '50%',
          transform: 'translateX(-50%)',
          whiteSpace: 'nowrap',
        }}
      >
        v1.0 · All PRs open as Drafts · Confidence: medium · Manual review required
      </div>
    </main>
  )
}
