export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-0)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '4rem',
            fontWeight: 700,
            color: 'var(--text-muted)',
            lineHeight: 1,
            marginBottom: '1rem',
          }}
        >
          404
        </p>
        <p style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          Page not found.
        </p>
      </div>
    </main>
  )
}
