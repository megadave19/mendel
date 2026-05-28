'use client'

/**
 * MascotPhaseContext — the journey-wide phase signal that drives the single
 * sidebar mascot. Pages call setPhase() in an effect; the sidebar renders
 * <BonesMascot pose={phase} />.
 *
 * Default = 'idle'. Pages that don't set a phase get 'idle' automatically.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { MascotPose } from '@/components/BonesMascot'

interface MascotPhaseValue {
  phase: MascotPose
  setPhase: (next: MascotPose) => void
}

const MascotPhaseContext = createContext<MascotPhaseValue | null>(null)

export function MascotPhaseProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<MascotPose>('idle')
  const stableSet = useCallback((next: MascotPose) => setPhase(next), [])
  const value = useMemo(() => ({ phase, setPhase: stableSet }), [phase, stableSet])
  return <MascotPhaseContext.Provider value={value}>{children}</MascotPhaseContext.Provider>
}

/**
 * Read + set the journey-wide mascot phase. Safe to call from any client
 * component beneath the provider. Outside the provider (e.g. on /connect
 * where the app layout shows no sidebar) returns a no-op so callers don't
 * have to branch.
 */
export function useMascotPhase(): MascotPhaseValue {
  const ctx = useContext(MascotPhaseContext)
  if (!ctx) return { phase: 'idle', setPhase: () => {} }
  return ctx
}
