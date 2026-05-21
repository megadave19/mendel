'use client'

/**
 * DepGraph3D — wireframe dependency graph, right pane of S4 (DESIGN.md §9, §11 S4).
 *
 * IMPLEMENTATION NOTE: built with vanilla Three.js (imperative, mounted via
 * useEffect), NOT React-Three-Fiber. Reason: @react-three/fiber@8 targets React
 * 18 and breaks under this project's React 19. `three` itself is version-agnostic,
 * so this is the safe path to working 3D in D2. Visual outcome matches §9's
 * "wireframe dependency graph; nodes pulse when touched by analysis."
 * (Deviation from §9's "R3F" wording logged in STATE.md / DESIGN.md.)
 *
 * Both contexts (DESIGN.md §12.1): running = active node pulses; rest = static
 * with hover-only highlight (hover not yet wired — D3/D4).
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export interface DepNode {
  id: string
  /** Display label (package name). */
  label: string
}

interface DepGraph3DProps {
  nodes: DepNode[]
  /** id of the node currently being analyzed — pulses phosphor. */
  activeNodeId?: string | null
  context?: 'running' | 'rest'
}

const PHOSPHOR = 0xc6ff3d
const CYAN = 0x3dffee
const MUTED = 0x333333

export function DepGraph3D({ nodes, activeNodeId, context = 'running' }: DepGraph3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  // Keep latest activeNodeId readable inside the animation loop without re-mounting.
  const activeRef = useRef<string | null | undefined>(activeNodeId)
  activeRef.current = activeNodeId
  const runningRef = useRef(context === 'running')
  runningRef.current = context === 'running'

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const width = mount.clientWidth || 360
    const height = mount.clientHeight || 400

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
    camera.position.z = 9

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const group = new THREE.Group()
    scene.add(group)

    // Lay nodes out on a sphere (Fibonacci) so the graph reads as a 3D structure.
    const count = Math.max(nodes.length, 1)
    const radius = 3.2
    const nodeMeshes: { id: string; mesh: THREE.Mesh; base: THREE.Vector3 }[] = []
    const positions: THREE.Vector3[] = []

    for (let i = 0; i < count; i++) {
      const y = 1 - (i / Math.max(count - 1, 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const phi = i * Math.PI * (3 - Math.sqrt(5))
      const pos = new THREE.Vector3(
        Math.cos(phi) * r * radius,
        y * radius,
        Math.sin(phi) * r * radius,
      )
      positions.push(pos)

      const geo = new THREE.IcosahedronGeometry(0.32, 0)
      const mat = new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.7 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(pos)
      group.add(mesh)
      if (nodes[i]) nodeMeshes.push({ id: nodes[i].id, mesh, base: pos.clone() })
    }

    // Edges: connect each node to its 2 nearest neighbors for an organic web.
    const edgeMat = new THREE.LineBasicMaterial({ color: MUTED, transparent: true, opacity: 0.5 })
    for (let i = 0; i < positions.length; i++) {
      const dists = positions
        .map((p, j) => ({ j, d: p.distanceTo(positions[i]) }))
        .filter((x) => x.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
      for (const { j } of dists) {
        const g = new THREE.BufferGeometry().setFromPoints([positions[i], positions[j]])
        group.add(new THREE.Line(g, edgeMat))
      }
    }

    let raf = 0
    const clock = new THREE.Clock()

    const animate = () => {
      raf = requestAnimationFrame(animate)
      const t = clock.getElapsedTime()

      // Slow auto-rotate (slower / paused-feel in rest mode).
      group.rotation.y += runningRef.current ? 0.0035 : 0.0012
      group.rotation.x = Math.sin(t * 0.15) * 0.15

      // Active node pulses phosphor + scales; others sit cyan.
      for (const n of nodeMeshes) {
        const mat = n.mesh.material as THREE.MeshBasicMaterial
        if (n.id === activeRef.current && runningRef.current) {
          const pulse = 1 + Math.sin(t * 6) * 0.25
          n.mesh.scale.setScalar(pulse)
          mat.color.setHex(PHOSPHOR)
          mat.opacity = 0.9
        } else {
          n.mesh.scale.setScalar(1)
          mat.color.setHex(CYAN)
          mat.opacity = 0.6
        }
      }

      renderer.render(scene, camera)
    }
    animate()

    // Handle container resize.
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || width
      const h = mount.clientHeight || height
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    ro.observe(mount)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.dispose()
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose()
          const m = obj.material
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose())
          else m.dispose()
        }
      })
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
    // Re-init only when the node set changes (positions/edges are derived from it).
  }, [nodes])

  return <div ref={mountRef} style={{ width: '100%', height: '100%', minHeight: 0 }} />
}
