'use client'

/**
 * PixelSkullHero — the S1 hero payoff (DESIGN.md §11 S1; reference: pixel/voxel
 * entity assembly + wireframe ghost layer).
 *
 * A skull silhouette is sampled to a pixel grid; particles fly in from a chaotic
 * cloud and SETTLE onto their target pixels (assembly with physical consequence,
 * not a fade). ~1s after the solid form lands, a wireframe ghost-skull traces in
 * over it and both layers coexist. Ambient comet particles drift continuously so
 * the canvas is never static ("the UI breathes").
 *
 * Pure canvas 2D — no R3F. Single glowing phosphor-lime accent (#C6FF3D) with a
 * cyan minority, glow via shadowBlur (light bleeds from within the pixels).
 * Respects prefers-reduced-motion: renders the assembled skull + wireframe static,
 * no fly-in, no comets.
 */

import { useEffect, useRef } from 'react'

const PHOSPHOR = '#C6FF3D'
const CYAN = '#3DFFEE'

interface PixelSkullHeroProps {
  size?: number
  /** ms before assembly begins (lets boot stages gate it). */
  startDelay?: number
}

interface Particle {
  tx: number; ty: number // target
  sx: number; sy: number // start (cloud)
  delay: number
  color: string
}

interface Comet {
  x: number; y: number; vx: number; vy: number; len: number; alpha: number; color: string
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

// Sample the skull silhouette (design coords 0..80, from the mascot proportions)
// into a list of "on" pixels on a grid, with eye sockets + nose punched out.
function sampleSkull(grid: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
    ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry) <= 1

  for (let y = 4; y <= 80; y += grid) {
    for (let x = 4; x <= 80; x += grid) {
      // Cranium: tall dome.
      const cranium = inEllipse(x, y, 40, 33, 28, 27) && y <= 52
      // Jaw: tapers inward toward a narrower chin (38..78), with rounded bottom.
      let jaw = false
      if (y >= 48 && y <= 78) {
        const halfW = 24 - ((y - 48) / 30) * 13 // 24 → 11
        jaw = Math.abs(x - 40) <= halfW && inEllipse(x, y, 40, 60, 26, 20)
      }
      if (!cranium && !jaw) continue
      // Cheekbone taper: shave the lower outer corners for a jaw, not a block.
      if (y > 56 && Math.abs(x - 40) > 24 - (y - 56) * 0.55) continue
      // Punch eye sockets (angled, slightly larger) + triangular nose cavity.
      if (inEllipse(x, y, 27, 35, 8.5, 9.5)) continue
      if (inEllipse(x, y, 53, 35, 8.5, 9.5)) continue
      if (y >= 44 && y <= 54 && Math.abs(x - 40) <= (y - 44) * 0.5 + 1) continue
      // Teeth gap line: thin break between upper jaw and chin.
      if (y >= 63 && y <= 65 && Math.abs(x - 40) <= 12 && (Math.round(x) % 5 < 2)) continue
      pts.push({ x, y })
    }
  }
  return pts
}

export function PixelSkullHero({ size = 340, startDelay = 0 }: PixelSkullHeroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    // Map design coords (0..80) → canvas px, centered with padding.
    const pad = size * 0.12
    const scale = (size - pad * 2) / 80
    const toX = (x: number) => pad + x * scale
    const toY = (y: number) => pad + y * scale

    const gridDesign = 2.6 // sampling density in design units
    const samples = sampleSkull(gridDesign)
    const pixel = gridDesign * scale * 0.82

    const particles: Particle[] = samples.map((s) => {
      const ang = Math.random() * Math.PI * 2
      const dist = size * (0.5 + Math.random() * 0.7)
      return {
        tx: toX(s.x),
        ty: toY(s.y),
        sx: size / 2 + Math.cos(ang) * dist,
        sy: size / 2 + Math.sin(ang) * dist,
        delay: Math.random() * 500,
        color: Math.random() < 0.12 ? CYAN : PHOSPHOR,
      }
    })

    const comets: Comet[] = Array.from({ length: reduced ? 0 : 26 }, () => {
      const edge = Math.floor(Math.random() * 4)
      const x = edge === 1 ? size : edge === 3 ? 0 : Math.random() * size
      const y = edge === 0 ? 0 : edge === 2 ? size : Math.random() * size
      const toCenter = Math.atan2(size / 2 - y, size / 2 - x) + (Math.random() - 0.5) * 0.8
      const sp = 0.2 + Math.random() * 0.5
      return {
        x, y,
        vx: Math.cos(toCenter) * sp,
        vy: Math.sin(toCenter) * sp,
        len: 6 + Math.random() * 14,
        alpha: 0.1 + Math.random() * 0.25,
        color: Math.random() < 0.3 ? CYAN : PHOSPHOR,
      }
    })

    // Skull outline path (cranium + jaw) for the wireframe ghost layer.
    const outline = new Path2D()
    outline.ellipse(toX(40), toY(33), 28 * scale, 27 * scale, 0, 0, Math.PI * 2)
    // tapering jaw → chin
    outline.moveTo(toX(16), toY(50))
    outline.quadraticCurveTo(toX(18), toY(74), toX(40), toY(78))
    outline.quadraticCurveTo(toX(62), toY(74), toX(64), toY(50))
    const socketL = new Path2D(); socketL.ellipse(toX(27), toY(35), 8.5 * scale, 9.5 * scale, 0, 0, Math.PI * 2)
    const socketR = new Path2D(); socketR.ellipse(toX(53), toY(35), 8.5 * scale, 9.5 * scale, 0, 0, Math.PI * 2)

    const ASSEMBLE_MS = 1500
    const WIRE_DELAY = ASSEMBLE_MS + 400
    let raf = 0
    let t0 = 0

    const draw = (now: number) => {
      if (!t0) t0 = now
      const elapsed = reduced ? ASSEMBLE_MS + WIRE_DELAY + 1000 : now - t0 - startDelay
      ctx.clearRect(0, 0, size, size)

      // ── ambient comets (background) ──
      ctx.lineCap = 'round'
      for (const c of comets) {
        c.x += c.vx; c.y += c.vy
        // wrap
        if (c.x < -20 || c.x > size + 20 || c.y < -20 || c.y > size + 20) {
          const edge = Math.floor(Math.random() * 4)
          c.x = edge === 1 ? size : edge === 3 ? 0 : Math.random() * size
          c.y = edge === 0 ? 0 : edge === 2 ? size : Math.random() * size
          const a = Math.atan2(size / 2 - c.y, size / 2 - c.x) + (Math.random() - 0.5) * 0.8
          const sp = 0.2 + Math.random() * 0.5
          c.vx = Math.cos(a) * sp; c.vy = Math.sin(a) * sp
        }
        ctx.strokeStyle = c.color
        ctx.globalAlpha = c.alpha
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(c.x, c.y)
        ctx.lineTo(c.x - c.vx * c.len, c.y - c.vy * c.len)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // ── assembling pixel skull ──
      ctx.shadowBlur = 8
      for (const p of particles) {
        const local = Math.max(0, Math.min(1, (elapsed - p.delay) / ASSEMBLE_MS))
        const e = easeOutCubic(local)
        const x = p.sx + (p.tx - p.sx) * e
        const y = p.sy + (p.ty - p.sy) * e
        ctx.fillStyle = p.color
        ctx.shadowColor = p.color
        ctx.globalAlpha = 0.35 + 0.65 * local
        ctx.fillRect(x - pixel / 2, y - pixel / 2, pixel, pixel)
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0

      // ── wireframe ghost (traces in after the solid form lands) ──
      const wireT = Math.max(0, Math.min(1, (elapsed - WIRE_DELAY) / 700))
      if (wireT > 0) {
        ctx.save()
        // slight scale-up = the "ghost" sits just outside the solid silhouette
        const cx = size / 2, cy = size / 2
        ctx.translate(cx, cy); ctx.scale(1.045, 1.045); ctx.translate(-cx, -cy)
        ctx.globalAlpha = wireT * 0.5
        ctx.strokeStyle = PHOSPHOR
        ctx.shadowColor = PHOSPHOR
        ctx.shadowBlur = 12
        ctx.lineWidth = 1
        ctx.stroke(outline)
        ctx.globalAlpha = wireT * 0.7
        ctx.strokeStyle = CYAN
        ctx.shadowColor = CYAN
        ctx.stroke(socketL)
        ctx.stroke(socketR)
        ctx.restore()
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
      }

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => cancelAnimationFrame(raf)
  }, [size, startDelay])

  return (
    <canvas
      ref={canvasRef}
      aria-label="Bones — the Mendel operator, assembling"
      style={{ width: size, height: size, display: 'block' }}
    />
  )
}
