'use client'

/**
 * BonesMascot — the single 2D mascot for Mendel (DESIGN.md §8, §12).
 *
 * Architecture (fixes prior flicker):
 *   • Two pose frames (when the pose has a loop) are STACKED as siblings and
 *     stay mounted for the lifetime of the pose. Only their opacity tweens.
 *     No unmount/remount on the loop tick → no decode flash, no key churn.
 *   • Pose changes are crossfaded via AnimatePresence with mode="wait" — the
 *     old pose fully fades out before the new one fades in, so there's never
 *     a half-and-half frame.
 *   • prefers-reduced-motion disables both crossfade and loop and snaps to
 *     the canonical frame.
 *
 * Rigged-puppet animation (real per-limb motion) is parked for v1.5.
 */

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

export type MascotPose =
  | 'idle' | 'scanning' | 'thinking' | 'detecting' | 'patching'
  | 'verifying' | 'success' | 'failure' | 'error'

/** All poses, idle first. Single source of truth (dev preview, tests). */
export const MASCOT_POSES: MascotPose[] = [
  'idle', 'scanning', 'thinking', 'detecting', 'patching', 'verifying', 'success', 'failure', 'error',
]

/** Poses that have a 2nd "loop" frame supplied by the owner. */
const LOOPED: ReadonlySet<MascotPose> = new Set(['idle', 'scanning', 'patching'])

/** Loop period in ms — frame swap happens every LOOP_MS. */
const LOOP_MS = 900
/** Opacity fade duration for the loop swap. Slower than the toggle so the */
/** transition reads as a breath, not a strobe. */
const LOOP_FADE_MS = 420
/** Pose-to-pose crossfade duration. */
const POSE_FADE_MS = 280

function poseSrc(pose: MascotPose, frame: 1 | 2): string {
  if (frame === 2 && LOOPED.has(pose)) return `/mascot/bones-${pose}-2.png`
  return `/mascot/bones-${pose}.png`
}

interface BonesMascotProps {
  pose?: MascotPose
  size?: number
  className?: string
  /** Optional alt-text override (default narrates the current pose). */
  alt?: string
}

export function BonesMascot({ pose = 'idle', size = 140, className, alt }: BonesMascotProps) {
  const reduced = useReducedMotion()
  const altText = alt ?? `Bones the maintainer, ${pose}`
  /**
   * §11 S7 spec: "Mascot success burst (lime ring expands, fades, 800ms total)"
   * when a PR is opened. Track previous pose; fire a one-shot ring when
   * transitioning from non-success → success. burstKey increments each fire so
   * AnimatePresence can re-mount the ring even on rapid re-triggers.
   */
  const prevPoseRef = useRef<MascotPose>(pose)
  const [burstKey, setBurstKey] = useState(0)
  useEffect(() => {
    if (pose === 'success' && prevPoseRef.current !== 'success' && !reduced) {
      setBurstKey((k) => k + 1)
    }
    prevPoseRef.current = pose
  }, [pose, reduced])

  return (
    <div
      className={className}
      data-mascot-pose={pose}
      style={{
        position: 'relative',
        width: size,
        height: size,
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pose}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: reduced ? 0 : POSE_FADE_MS / 1000, ease: 'easeOut' }}
          style={{ position: 'absolute', inset: 0 }}
        >
          <PoseStack pose={pose} size={size} altText={altText} reduced={!!reduced} />
        </motion.div>
      </AnimatePresence>

      {/* Success burst — lime ring expands + fades, 800ms one-shot. */}
      <AnimatePresence>
        {burstKey > 0 && (
          <motion.span
            key={burstKey}
            aria-hidden
            initial={{ scale: 0.6, opacity: 0.7 }}
            animate={{ scale: 1.8, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              inset: 0,
              border: '2px solid var(--accent-primary)',
              borderRadius: '50%',
              pointerEvents: 'none',
              boxShadow: '0 0 32px rgba(198,255,61,0.5)',
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Stacks frame 1 and (when present) frame 2 of a single pose. Both <Image>s
 * stay mounted; only their opacity changes — so no decode/repaint per tick.
 */
function PoseStack({
  pose, size, altText, reduced,
}: { pose: MascotPose; size: number; altText: string; reduced: boolean }) {
  const looped = LOOPED.has(pose)
  // Active frame state (1 or 2). Always 1 for unlooped poses or reduced motion.
  const [active, setActive] = useState<1 | 2>(1)

  useEffect(() => {
    setActive(1)
    if (reduced || !looped) return
    const id = window.setInterval(() => setActive((f) => (f === 1 ? 2 : 1)), LOOP_MS)
    return () => window.clearInterval(id)
  }, [pose, looped, reduced])

  const src1 = poseSrc(pose, 1)
  const src2 = looped ? poseSrc(pose, 2) : null

  return (
    <>
      <Image
        key={src1}
        src={src1}
        alt={altText}
        width={size}
        height={size}
        priority={pose === 'idle'}
        draggable={false}
        data-mascot-frame={1}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          imageRendering: 'pixelated',
          opacity: active === 1 || !src2 ? 1 : 0,
          transition: reduced ? 'none' : `opacity ${LOOP_FADE_MS}ms ease-in-out`,
        }}
      />
      {src2 && (
        <Image
          key={src2}
          src={src2}
          alt=""
          aria-hidden
          width={size}
          height={size}
          draggable={false}
          data-mascot-frame={2}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            imageRendering: 'pixelated',
            opacity: active === 2 ? 1 : 0,
            transition: reduced ? 'none' : `opacity ${LOOP_FADE_MS}ms ease-in-out`,
          }}
        />
      )}
    </>
  )
}
