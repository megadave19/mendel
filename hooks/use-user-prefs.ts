/**
 * useUserPrefs — read localStorage-backed Settings preferences reactively
 * across the app. Closes the §7.2a "dead-control" gap discovered 2026-05-31:
 * the Settings page wrote prefs to localStorage + html dataset, but NOTHING
 * read them. Toggles fired toasts; consequence chain was severed.
 *
 * The Settings page now dispatches `mendel:pref-change` after writing each
 * pref. Consumers using these hooks re-render. Cross-tab updates flow via
 * the browser's native `storage` event.
 *
 * Single source of truth for the keys + defaults lives in PREF_KEY below so
 * the writer (settings/page.tsx) and the readers can never drift.
 */

'use client'

import { useEffect, useState } from 'react'

export const PREF_KEY = {
  reduceMotion: 'mendel:pref:reduceMotion',
  mascot: 'mendel:pref:mascot',
} as const

export const PREF_DEFAULT: Record<keyof typeof PREF_KEY, boolean> = {
  reduceMotion: false,
  mascot: true,
}

/** Custom event the Settings toggles fire after writing localStorage. */
export const PREF_CHANGE_EVENT = 'mendel:pref-change'

function readBoolPref(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (raw === '1') return true
  if (raw === '0') return false
  return fallback
}

function useBoolPref(key: string, fallback: boolean): boolean {
  // SSR-safe: start with the fallback on the server, hydrate from localStorage
  // on mount. A small flash is acceptable for prefs that only affect chrome
  // (mascot visibility, motion). Critical paint state goes through the
  // inline-script in app/layout.tsx that sets html[data-*] BEFORE first paint.
  const [value, setValue] = useState(fallback)

  useEffect(() => {
    setValue(readBoolPref(key, fallback))

    function refresh() { setValue(readBoolPref(key, fallback)) }

    // Same-tab updates: the Settings page dispatches this after writing.
    window.addEventListener(PREF_CHANGE_EVENT, refresh)
    // Cross-tab updates: native storage event fires only in OTHER tabs.
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key === key || e.key === null) refresh()
    })

    return () => {
      window.removeEventListener(PREF_CHANGE_EVENT, refresh)
      window.removeEventListener('storage', refresh as EventListener)
    }
  }, [key, fallback])

  return value
}

/** True when the user has reduce-motion enabled in Settings. */
export function useReduceMotion(): boolean {
  return useBoolPref(PREF_KEY.reduceMotion, PREF_DEFAULT.reduceMotion)
}

/** True when the user wants the sidebar mascot visible (default: yes). */
export function useMascotEnabled(): boolean {
  return useBoolPref(PREF_KEY.mascot, PREF_DEFAULT.mascot)
}

/** Notify all readers in this tab that prefs changed. Called by Settings. */
export function notifyPrefChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PREF_CHANGE_EVENT))
  }
}
