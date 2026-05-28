'use client'

/**
 * /dev/mascot — Bones pose preview in isolation.
 *
 * CLAUDE.md §6b workflow step 5: build components in isolation at /dev/[component]
 * before integrating. This route lets the PM cycle every pose and confirm the
 * 2D Bones art + crossfade + loop frames work end-to-end.
 *
 * Dev-only surface. Not linked from the app nav; not part of the 7 Phase D routes.
 */

import { useState } from 'react'
import { BonesMascot, MASCOT_POSES, type MascotPose } from '@/components/BonesMascot'

export default function DevMascotPage() {
  const [pose, setPose] = useState<MascotPose>('idle')
  const [size, setSize] = useState<number>(280)

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0A0A0A',
        color: '#F5F5F5',
        fontFamily: 'var(--font-display, "JetBrains Mono", monospace)',
        padding: '3rem 2rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2.5rem',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <p
          style={{
            fontSize: '0.625rem',
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: '#555555',
            marginBottom: '0.5rem',
          }}
        >
          /dev/mascot · isolation preview
        </p>
        <h1
          style={{
            fontSize: '1.75rem',
            fontWeight: 700,
            letterSpacing: '0.05em',
            color: '#C6FF3D',
            textShadow: '0 0 24px rgba(198,255,61,0.35)',
          }}
        >
          BONES
        </h1>
        <p style={{ fontSize: '0.75rem', color: '#9A9A9A', marginTop: '0.5rem' }}>
          Maintainer of the Mendel machine · 2D art · crossfade + 2-frame loop
        </p>
      </div>

      {/* Stage */}
      <div
        style={{
          padding: '1.5rem',
          border: '1px solid rgba(255,255,255,0.12)',
          background: '#111111',
        }}
      >
        <BonesMascot pose={pose} size={size} />
      </div>

      {/* Size + pose readout */}
      <div
        style={{
          fontSize: '0.75rem',
          letterSpacing: '0.15em',
          color: '#9A9A9A',
          display: 'flex',
          gap: '2rem',
        }}
      >
        <span>
          POSE: <span style={{ color: '#3DFFEE' }}>{pose}</span>
        </span>
        <span>
          SIZE: <span style={{ color: '#3DFFEE' }}>{size}px</span>
        </span>
      </div>

      {/* Size slider */}
      <input
        type="range"
        min={56}
        max={400}
        step={4}
        value={size}
        onChange={(e) => setSize(Number(e.target.value))}
        style={{ width: '320px', accentColor: '#C6FF3D' }}
        aria-label="Mascot size"
      />

      {/* Pose switcher */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          justifyContent: 'center',
          maxWidth: '640px',
        }}
      >
        {MASCOT_POSES.map((p) => {
          const active = p === pose
          return (
            <button
              key={p}
              onClick={() => setPose(p)}
              style={{
                padding: '0.5rem 0.875rem',
                fontSize: '0.6875rem',
                fontFamily: 'inherit',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                background: active ? '#C6FF3D' : 'transparent',
                color: active ? '#0A0A0A' : '#9A9A9A',
                border: `1px solid ${active ? '#C6FF3D' : 'rgba(255,255,255,0.12)'}`,
                boxShadow: active ? '0 0 16px rgba(198,255,61,0.35)' : 'none',
                transition: 'all 120ms ease-out',
              }}
            >
              {p}
            </button>
          )
        })}
      </div>

      {/* Status note */}
      <p
        style={{
          fontSize: '0.625rem',
          color: '#555555',
          maxWidth: '520px',
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        Each pose loads <span style={{ color: '#FFB84D' }}>/mascot/bones-[pose].png</span>. Idle,
        scanning, and patching also load a <span style={{ color: '#FFB84D' }}>-2.png</span> loop
        frame that alternates every 600ms for subtle life. <code>prefers-reduced-motion</code>{' '}
        disables both crossfade and loop and snaps to the canonical frame.
      </p>
    </div>
  )
}
