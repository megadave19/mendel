'use client'

import { motion, useReducedMotion } from 'framer-motion'

export type MascotState =
  | 'idle'
  | 'scanning'
  | 'thinking'
  | 'diagnosing'
  | 'patching'
  | 'verifying'
  | 'success'
  | 'error'
  | 'waiting'

interface SkullProps {
  state?: MascotState
  size?: number
  className?: string
  showLabel?: boolean
}

const STATE_LABELS: Record<MascotState, string> = {
  idle: 'Idle',
  scanning: 'Scanning...',
  thinking: 'Thinking...',
  diagnosing: 'Diagnosing...',
  patching: 'Patching...',
  verifying: 'Verifying...',
  success: 'Done!',
  error: 'Uh oh.',
  waiting: 'Waiting...',
}

const STATE_COLORS: Record<MascotState, string> = {
  idle: '#c6ff3d',
  scanning: '#3dffee',
  thinking: '#3dffee',
  diagnosing: '#ffb84d',
  patching: '#c6ff3d',
  verifying: '#ffb84d',
  success: '#c6ff3d',
  error: '#ff4d5e',
  waiting: '#555555',
}

// Eye contents per state — rendered inside the skull's eye sockets
function Eyes({ state, reduced }: { state: MascotState; reduced: boolean }) {
  const color = STATE_COLORS[state]

  switch (state) {
    case 'scanning':
      return (
        <g>
          <motion.circle cx="25" cy="34" r="5" fill={color}
            animate={reduced ? {} : { cx: [19, 31, 19] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
          />
          <motion.circle cx="55" cy="34" r="5" fill={color}
            animate={reduced ? {} : { cx: [49, 61, 49] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'linear', delay: 0.7 }}
          />
        </g>
      )

    case 'thinking':
      return (
        <g>
          <motion.circle cx="25" cy="34" r="4" fill={color}
            animate={reduced ? {} : { opacity: [1, 0.2, 1], scale: [1, 0.7, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.circle cx="55" cy="34" r="4" fill={color}
            animate={reduced ? {} : { opacity: [0.2, 1, 0.2], scale: [0.7, 1, 0.7] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </g>
      )

    case 'diagnosing':
      return (
        <g>
          {/* Focused narrow eyes */}
          <rect x="16" y="30" width="18" height="9" rx="4.5" fill={color} opacity={0.9} />
          <rect x="46" y="30" width="18" height="9" rx="4.5" fill={color} opacity={0.9} />
          {/* Pupils */}
          <circle cx="25" cy="34" r="3" fill="#0a0a0a" />
          <circle cx="55" cy="34" r="3" fill="#0a0a0a" />
        </g>
      )

    case 'patching':
      return (
        <g>
          <motion.circle cx="25" cy="34" r="5" fill={color}
            animate={reduced ? {} : { scale: [1, 1.3, 1], opacity: [0.9, 1, 0.9] }}
            transition={{ duration: 0.4, repeat: Infinity }}
          />
          <motion.circle cx="55" cy="34" r="5" fill={color}
            animate={reduced ? {} : { scale: [1.3, 1, 1.3], opacity: [1, 0.9, 1] }}
            transition={{ duration: 0.4, repeat: Infinity }}
          />
        </g>
      )

    case 'verifying':
      return (
        <g>
          {/* Left eye — normal */}
          <motion.circle cx="25" cy="34" r="5" fill={color}
            animate={reduced ? {} : { opacity: [1, 0.6, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          {/* Right eye — magnifying glass */}
          <circle cx="55" cy="33" r="7" fill="none" stroke={color} strokeWidth="2" />
          <line x1="60" y1="38" x2="64" y2="42" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <circle cx="55" cy="33" r="3" fill={color} opacity={0.4} />
        </g>
      )

    case 'success':
      return (
        <g>
          {/* Star eyes */}
          <motion.text x="15" y="42" fontSize="16" fill={color} fontFamily="monospace"
            animate={reduced ? {} : { scale: [1, 1.2, 1], rotate: [0, 15, -15, 0] }}
            transition={{ duration: 0.6, repeat: Infinity }}
            style={{ transformOrigin: '25px 34px' }}
          >★</motion.text>
          <motion.text x="45" y="42" fontSize="16" fill={color} fontFamily="monospace"
            animate={reduced ? {} : { scale: [1.2, 1, 1.2], rotate: [0, -15, 15, 0] }}
            transition={{ duration: 0.6, repeat: Infinity }}
            style={{ transformOrigin: '55px 34px' }}
          >★</motion.text>
        </g>
      )

    case 'error':
      return (
        <g>
          <motion.text x="16" y="42" fontSize="16" fill={color} fontFamily="monospace" fontWeight="bold"
            animate={reduced ? {} : { opacity: [1, 0.3, 1] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          >✕</motion.text>
          <motion.text x="46" y="42" fontSize="16" fill={color} fontFamily="monospace" fontWeight="bold"
            animate={reduced ? {} : { opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          >✕</motion.text>
        </g>
      )

    case 'waiting':
      return (
        <g>
          {/* Droopy half-closed eyes */}
          <rect x="14" y="29" width="22" height="12" rx="6" fill="#0a0a0a" />
          <rect x="44" y="29" width="22" height="12" rx="6" fill="#0a0a0a" />
          {/* Droopy eyelids */}
          <rect x="14" y="29" width="22" height="8" rx="4" fill="#1a1a1a" />
          <rect x="44" y="29" width="22" height="8" rx="4" fill="#1a1a1a" />
          {/* Sleepy pupils */}
          <motion.circle cx="25" cy="37" r="3" fill={color}
            animate={reduced ? {} : { opacity: [0.6, 0.3, 0.6] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
          <motion.circle cx="55" cy="37" r="3" fill={color}
            animate={reduced ? {} : { opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 3, repeat: Infinity, delay: 0.4 }}
          />
        </g>
      )

    default: // idle
      return (
        <g>
          <motion.circle cx="25" cy="34" r="5" fill={color}
            animate={reduced ? {} : { opacity: [0.9, 0.5, 0.9], r: [5, 4, 5] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.circle cx="55" cy="34" r="5" fill={color}
            animate={reduced ? {} : { opacity: [0.5, 0.9, 0.5], r: [4, 5, 4] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        </g>
      )
  }
}

// Mouth shape varies by state
function Mouth({ state, reduced }: { state: MascotState; reduced: boolean }) {
  switch (state) {
    case 'error':
      return (
        <g>
          {/* Frown */}
          <path d="M 22 68 Q 40 62 58 68" fill="none" stroke="#ff4d5e" strokeWidth="1.5" strokeLinecap="round" />
          {/* Teeth — grey for unhappy */}
          {[22, 30, 38, 46].map((x, i) => (
            <rect key={i} x={x} y={68} width={6} height={9} rx="2" fill="#555" />
          ))}
        </g>
      )
    case 'waiting':
      return (
        <g>
          {/* Yawning O mouth */}
          <motion.ellipse cx="40" cy="70" rx="10" ry="8" fill="#0a0a0a" stroke="#555" strokeWidth="1.5"
            animate={reduced ? {} : { ry: [8, 12, 8] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          {/* Top teeth */}
          {[32, 38, 44].map((x, i) => (
            <rect key={i} x={x} y={66} width={4} height={6} rx="1.5" fill="#555" />
          ))}
        </g>
      )
    case 'success':
      return (
        <g>
          {/* Big grin */}
          <path d="M 18 64 Q 40 80 62 64" fill="none" stroke="#c6ff3d" strokeWidth="2" strokeLinecap="round" />
          {/* Bright teeth */}
          {[20, 28, 36, 44, 52].map((x, i) => (
            <motion.rect key={i} x={x} y={65} width={6} height={10} rx="2" fill="#c6ff3d" opacity={0.9}
              animate={reduced ? {} : { opacity: [0.9, 1, 0.9] }}
              transition={{ duration: 0.3, repeat: Infinity, delay: i * 0.08 }}
            />
          ))}
        </g>
      )
    default:
      return (
        <g>
          {/* Normal grin */}
          <path d="M 20 65 Q 40 74 60 65" fill="none" stroke="#c6ff3d" strokeWidth="1.5" strokeLinecap="round" opacity={0.6} />
          {/* Teeth */}
          {[22, 30, 38, 46].map((x, i) => (
            <rect key={i} x={x} y={65} width={6} height={9} rx="2" fill="#c6ff3d" opacity={0.5} />
          ))}
        </g>
      )
  }
}

const FLOAT_VARIANTS = {
  idle: { y: [0, -6, 0], transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } },
  scanning: { y: [0, -3, 0], rotate: [-2, 2, -2], transition: { duration: 1.5, repeat: Infinity } },
  thinking: { rotate: [-5, 5, -5], y: [0, -4, 0], transition: { duration: 2, repeat: Infinity } },
  diagnosing: { y: [0, -2, 0], rotate: [-1, 1, -1], transition: { duration: 1, repeat: Infinity } },
  patching: { y: [0, -4, 4, 0], rotate: [-3, 3, -3], transition: { duration: 0.5, repeat: Infinity } },
  verifying: { rotate: [-3, 3, -3], transition: { duration: 2, repeat: Infinity } },
  success: { scale: [1, 1.08, 1], y: [0, -10, 0], transition: { duration: 0.6, repeat: Infinity } },
  error: { x: [0, -4, 4, -4, 0], transition: { duration: 0.4, repeat: Infinity } },
  waiting: { y: [0, -2, 0], rotate: [0, 2, 0], transition: { duration: 4, repeat: Infinity } },
}

export function Skull({ state = 'idle', size = 80, className, showLabel = false }: SkullProps) {
  const reduced = useReducedMotion() ?? false
  const glowColor = STATE_COLORS[state]
  // When reduced motion is preferred, skip all floating/shake animations
  const animation = reduced ? {} : FLOAT_VARIANTS[state]

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
      <motion.div
        animate={animation}
        style={{
          filter: `drop-shadow(0 0 12px ${glowColor}66)`,
          willChange: 'transform',
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 80 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* ── Skull cranium ── */}
          <ellipse cx="40" cy="36" rx="32" ry="30" fill="#111" stroke={glowColor} strokeWidth="1.5" />

          {/* ── Jaw ── */}
          <path
            d="M 16 58 Q 16 78 40 78 Q 64 78 64 58"
            fill="#111" stroke={glowColor} strokeWidth="1.5"
          />

          {/* ── Eye sockets (always dark) ── */}
          <ellipse cx="25" cy="34" rx="12" ry="13" fill="#0a0a0a" />
          <ellipse cx="55" cy="34" rx="12" ry="13" fill="#0a0a0a" />

          {/* ── Nose cavity ── */}
          <ellipse cx="40" cy="50" rx="4.5" ry="6" fill="#0a0a0a" />

          {/* ── Eyes (state-driven) ── */}
          <Eyes state={state} reduced={reduced} />

          {/* ── Jaw line separator ── */}
          <line x1="18" y1="58" x2="62" y2="58" stroke={glowColor} strokeWidth="1" opacity={0.4} />

          {/* ── Mouth / teeth ── */}
          <Mouth state={state} reduced={reduced} />

          {/* ── Cheekbone highlights ── */}
          <ellipse cx="18" cy="46" rx="4" ry="3" fill={glowColor} opacity={0.08} />
          <ellipse cx="62" cy="46" rx="4" ry="3" fill={glowColor} opacity={0.08} />

          {/* ── Forehead pixel deco ── */}
          <rect x="36" y="10" width="2" height="2" fill={glowColor} opacity={0.5} />
          <rect x="40" y="8" width="2" height="2" fill={glowColor} opacity={0.3} />
          <rect x="44" y="10" width="2" height="2" fill={glowColor} opacity={0.5} />
        </svg>
      </motion.div>

      {showLabel && (
        <motion.p
          key={state}
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.625rem',
            fontWeight: 600,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: glowColor,
          }}
        >
          {STATE_LABELS[state]}
        </motion.p>
      )}
    </div>
  )
}
