// Live Agent Console — Phase 1C
export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main style={{ minHeight: '100vh', padding: '2rem', background: 'var(--bg-0)' }}>
      <h1 style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
        Scan {id}
      </h1>
      <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
        Live Agent Console coming in Phase 1C.
      </p>
    </main>
  )
}
