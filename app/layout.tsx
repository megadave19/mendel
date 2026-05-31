import type { Metadata } from 'next'
import Script from 'next/script'
import { GeistSans } from 'geist/font/sans'
import { JetBrains_Mono } from 'next/font/google'
import { ToastProvider } from '@/components/shared/toast'
import './globals.css'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

// Fix #13 (audit-2) — default metadata + Open Graph so shared links have a card.
// Per-page metadata extends/overrides this in each route's `export const metadata`.
export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: {
    default: 'Mendel — Autonomous OSS Maintenance Agent',
    template: '%s · Mendel',
  },
  description:
    'Scans GitHub repos for stale dependencies, writes migration patches, verifies in an isolated sandbox, and opens Draft PRs with honest medium-confidence framing.',
  applicationName: 'Mendel',
  openGraph: {
    type: 'website',
    title: 'Mendel — Autonomous OSS Maintenance Agent',
    description:
      'Draft PRs for stale deps, with diagnoses + verification + an honest "Not Analyzed" disclosure.',
    siteName: 'Mendel',
  },
  twitter: { card: 'summary' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${jetbrainsMono.variable}`}>
      <body>
        {/* No-flash pref hydration. next/script strategy="beforeInteractive"
            guarantees this static asset runs BEFORE any React code in the
            App Router (Next.js 15). Sets <html data-reduce-motion> and
            <html data-mascot> from localStorage. Closes the §7.2a dead-
            control gap discovered 2026-05-31. CLAUDE.md §5 rule 9 honored —
            external src, no inline html injection. */}
        <Script src="/prefs-init.js" strategy="beforeInteractive" />
        {/* Fix #11 (audit-2) — skip-to-content for keyboard users. */}
        <a href="#main" className="skip-to-content">Skip to content</a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
