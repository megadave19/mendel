'use client'

// Global CRT scan-line + vignette overlay — sits above all content
// Respects prefers-reduced-motion (defined in globals.css)
export function CRTOverlay() {
  return (
    <>
      <div className="crt-scanline" aria-hidden="true" />
      <div className="crt-overlay" aria-hidden="true" />
      <div className="crt-vignette" aria-hidden="true" />
    </>
  )
}
