'use client'

/**
 * Fix #12 (audit-2) — minimal toast system.
 * Provider mounted near root; useToast() fires success/error/info from anywhere.
 * On-brand: bordered mono pills bottom-right, auto-dismiss 4s, slide+fade.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

type Kind = 'success' | 'error' | 'info'
interface Toast { id: number; kind: Kind; text: string }

const Ctx = createContext<((kind: Kind, text: string) => void) | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          pointerEvents: 'none',
        }}
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const color =
              t.kind === 'success' ? 'var(--accent-primary)'
              : t.kind === 'error' ? 'var(--accent-danger)'
              : 'var(--accent-secondary)'
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 16, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                role="status"
                style={{
                  pointerEvents: 'auto',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  color,
                  background: 'var(--bg-1)',
                  border: `1px solid ${color}`,
                  padding: '0.625rem 0.9rem',
                  boxShadow: `0 0 18px ${color}55`,
                  maxWidth: 360,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                {t.text}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const push = useContext(Ctx)
  if (!push) {
    // Provider not mounted — degrade to console so tests/dev pages don't throw.
    return {
      success: (t: string) => console.log('[toast:success]', t),
      error: (t: string) => console.error('[toast:error]', t),
      info: (t: string) => console.log('[toast:info]', t),
    }
  }
  return {
    success: (t: string) => push('success', t),
    error: (t: string) => push('error', t),
    info: (t: string) => push('info', t),
  }
}

/** Convenience hook to fire a toast once on mount (e.g., onboarding hint). */
export function useToastOnce(kind: Kind, text: string, enabled = true) {
  const t = useToast()
  useEffect(() => {
    if (enabled) t[kind](text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
