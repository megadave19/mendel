export async function register() {
  // Validate required environment variables at server startup (Node.js runtime only)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@/lib/env')
  }
}
