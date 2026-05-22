'use client'

/**
 * MascotWidget — "Bones", the operator of the Mendel machine (DESIGN.md §8, §12).
 * Reacts to the agent's phase; never speaks (§8 anti-rule).
 *
 * Implementation: an owner-supplied 3D model (optimized neon skeleton, ~620KB
 * glb) rendered with VANILLA Three.js — not R3F (R3F v8 breaks on React 19).
 * The model ships ONE walk clip and no per-emotion animations, so the 9 poses are
 * expressed PROCEDURALLY: rotation / bob / tilt / jitter / scale + emissive glow
 * color per phase (matches §8 "reactions" + the reference "glow from within").
 *
 * If the glb fails to load, falls back to the on-brand placeholder so screens
 * never break. `pose` is the only prop any screen passes.
 */

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type MascotPose =
  | 'idle' | 'scanning' | 'thinking' | 'detecting' | 'patching'
  | 'verifying' | 'success' | 'failure' | 'error'

/** All poses, idle first. Single source of truth (dev preview, tests). */
export const MASCOT_POSES: MascotPose[] = [
  'idle', 'scanning', 'thinking', 'detecting', 'patching', 'verifying', 'success', 'failure', 'error',
]

const MODEL_SRC = '/mascot/bones.glb'

// Per-pose procedural "emotion" parameters. The render loop lerps toward these.
interface PoseFX {
  glow: number        // emissive color (hex)
  emissive: number    // emissive intensity
  rotSpeed: number    // continuous Y spin (rad/s)
  sway: number        // L-R head-track sway amplitude (rad)
  bob: number         // vertical bob amplitude
  bobSpeed: number
  tilt: number        // static X tilt (rad) — droop/attention
  jitter: number      // random jitter (error/glitch)
  scale: number       // overall scale multiplier
}

const PHOSPHOR = 0xc6ff3d, CYAN = 0x3dffee, AMBER = 0xffb84d, DANGER = 0xff4d5e

const POSE_FX: Record<MascotPose, PoseFX> = {
  idle:      { glow: PHOSPHOR, emissive: 0.6, rotSpeed: 0.3,  sway: 0,    bob: 0.04, bobSpeed: 1.2, tilt: 0,     jitter: 0,    scale: 1 },
  scanning:  { glow: CYAN,     emissive: 0.9, rotSpeed: 0,    sway: 0.5,  bob: 0.02, bobSpeed: 2,   tilt: 0,     jitter: 0,    scale: 1 },
  thinking:  { glow: CYAN,     emissive: 0.8, rotSpeed: 0.1,  sway: 0,    bob: 0.02, bobSpeed: 1,   tilt: 0.12,  jitter: 0,    scale: 1 },
  detecting: { glow: PHOSPHOR, emissive: 1.2, rotSpeed: 0,    sway: 0,    bob: 0,    bobSpeed: 0,   tilt: -0.08, jitter: 0,    scale: 1.05 },
  patching:  { glow: PHOSPHOR, emissive: 1.0, rotSpeed: 0.5,  sway: 0,    bob: 0.06, bobSpeed: 3.5, tilt: 0,     jitter: 0,    scale: 1 },
  verifying: { glow: AMBER,    emissive: 0.9, rotSpeed: 0.4,  sway: 0,    bob: 0.03, bobSpeed: 1.5, tilt: 0,     jitter: 0,    scale: 1 },
  success:   { glow: PHOSPHOR, emissive: 1.6, rotSpeed: 1.2,  sway: 0,    bob: 0.12, bobSpeed: 4,   tilt: 0,     jitter: 0,    scale: 1.08 },
  failure:   { glow: DANGER,   emissive: 0.5, rotSpeed: 0,    sway: 0,    bob: 0,    bobSpeed: 0,   tilt: 0.3,   jitter: 0,    scale: 0.96 },
  error:     { glow: DANGER,   emissive: 1.0, rotSpeed: 0,    sway: 0,    bob: 0,    bobSpeed: 0,   tilt: 0,     jitter: 0.04, scale: 1 },
}

interface MascotWidgetProps {
  pose?: MascotPose
  size?: number
  className?: string
}

export function MascotWidget({ pose = 'idle', size = 200, className }: MascotWidgetProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const poseRef = useRef<MascotPose>(pose)
  poseRef.current = pose
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(size, size)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    // Neon model is largely self-lit; modest fill so non-emissive parts read.
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const key = new THREE.DirectionalLight(0xffffff, 0.8)
    key.position.set(1, 2, 2)
    scene.add(key)

    const root = new THREE.Group()
    scene.add(root)

    const materials: THREE.MeshStandardMaterial[] = []
    let raf = 0
    let disposed = false
    const clock = new THREE.Clock()
    // Smoothed state (lerped toward POSE_FX[pose]).
    const cur = { emissive: 0.6, glow: new THREE.Color(PHOSPHOR), rotSpeed: 0.3, sway: 0, bob: 0.04, bobSpeed: 1.2, tilt: 0, jitter: 0, scale: 1 }
    let baseRotY = 0

    new GLTFLoader().load(
      MODEL_SRC,
      (gltf) => {
        if (disposed) return
        const model = gltf.scene

        // Frame the model: center it, scale to fit, drop pivot to its center.
        const box = new THREE.Box3().setFromObject(model)
        const c = box.getCenter(new THREE.Vector3())
        const sz = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(sz.x, sz.y, sz.z) || 1
        model.position.sub(c) // center at origin
        const fit = 1.6 / maxDim
        model.scale.setScalar(fit)
        root.add(model)

        // The model bakes its neon-green into its textures, which would multiply
        // away any phase tint. Replace every material with a fresh one we fully
        // control: a dark skeleton that GLOWS in the phase color (on-brand —
        // single glowing accent from within). The render loop drives the color.
        model.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.isMesh) {
            const mat = new THREE.MeshStandardMaterial({
              color: 0x0a0a0a,
              emissive: new THREE.Color(PHOSPHOR),
              emissiveIntensity: 0.6,
              metalness: 0.1,
              roughness: 0.6,
            })
            mesh.material = mat
            materials.push(mat)
          }
        })

        camera.position.set(0, 0.1, 2.6)
        camera.lookAt(0, 0, 0)
        setFailed(false)
      },
      undefined,
      () => { if (!disposed) setFailed(true) },
    )

    const tmpColor = new THREE.Color()
    const animate = () => {
      raf = requestAnimationFrame(animate)
      // getDelta FIRST (it advances the clock); read elapsedTime after. Calling
      // getElapsedTime() before getDelta() makes getDelta() return ~0 → no lerp.
      const dt = Math.min(clock.getDelta(), 0.05)
      const t = clock.elapsedTime
      const fx = POSE_FX[poseRef.current]

      // Lerp smoothed state toward the target pose params (mechanical-ish snap).
      const k = reduced ? 1 : Math.min(dt * 6, 1)
      cur.emissive += (fx.emissive - cur.emissive) * k
      cur.rotSpeed += (fx.rotSpeed - cur.rotSpeed) * k
      cur.sway += (fx.sway - cur.sway) * k
      cur.bob += (fx.bob - cur.bob) * k
      cur.bobSpeed += (fx.bobSpeed - cur.bobSpeed) * k
      cur.tilt += (fx.tilt - cur.tilt) * k
      cur.jitter += (fx.jitter - cur.jitter) * k
      cur.scale += (fx.scale - cur.scale) * k
      cur.glow.lerp(tmpColor.setHex(fx.glow), k)

      if (!reduced) {
        baseRotY += cur.rotSpeed * dt
        root.rotation.y = baseRotY + Math.sin(t * 2) * cur.sway
        root.rotation.x = cur.tilt + (cur.jitter ? (Math.random() - 0.5) * cur.jitter * 8 : 0)
        root.position.y = Math.sin(t * cur.bobSpeed) * cur.bob + (cur.jitter ? (Math.random() - 0.5) * cur.jitter : 0)
        root.position.x = cur.jitter ? (Math.random() - 0.5) * cur.jitter : 0
      }
      root.scale.setScalar(cur.scale)

      for (const m of materials) {
        m.emissive.copy(cur.glow)
        m.emissiveIntensity = cur.emissive
      }
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      renderer.dispose()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose()
          const m = mesh.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m?.dispose()
        }
      })
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [size])

  if (failed) return <MascotPlaceholder pose={pose} size={size} className={className} />

  return <div ref={mountRef} className={className} data-mascot-pose={pose} style={{ width: size, height: size }} />
}

// ── Fallback (load failure only) ──────────────────────────────────────────────
function MascotPlaceholder({ pose, size, className }: { pose: MascotPose; size: number; className?: string }) {
  return (
    <div
      className={className}
      data-mascot-pose={pose}
      data-mascot-status="placeholder"
      style={{
        width: size, height: size, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
        background: 'repeating-linear-gradient(0deg, #0A0A0A, #0A0A0A 2px, #111111 2px, #111111 4px)',
        border: '1px solid var(--border-strong, rgba(255,255,255,0.12))', color: '#C6FF3D',
        fontFamily: 'var(--font-display, "JetBrains Mono", monospace)', textAlign: 'center', userSelect: 'none',
      }}
    >
      <span style={{ fontSize: '0.625rem', letterSpacing: '0.2em', color: '#555' }}>BONES</span>
      <span style={{ fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', textShadow: '0 0 12px rgba(198,255,61,0.45)' }}>{pose}</span>
      <span style={{ fontSize: '0.5rem', letterSpacing: '0.15em', color: '#FFB84D' }}>model unavailable</span>
    </div>
  )
}
