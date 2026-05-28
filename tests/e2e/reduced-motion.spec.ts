/**
 * Gate D4 — prefers-reduced-motion sweep.
 *
 * Per CLAUDE.md §7.3 Phase 1D Gate: "Reduce-motion preference respected on
 * any animation-heavy screen."
 *
 * What we actually verify (not "are elements rendered" — that's an
 * implementation detail) but **"is any perceptible animation running"**.
 * The app uses two overlapping mechanisms:
 *   1. Component-level: `useReducedMotion()` makes some components opt-out
 *      (Particles returns null, BonesMascot disables its loop interval).
 *   2. Global CSS: `@media (prefers-reduced-motion: reduce) { * { ... } }`
 *      clamps `animation-duration: 0.01ms !important`.
 *
 * The component layer is a perf optimization; the CSS layer is the
 * accessibility guarantee. Tests below assert the user-facing OUTCOME
 * (no animation > 50ms) so either path satisfies them.
 *
 * Implementation note (2026-05-27): `test.use({ reducedMotion: 'reduce' })`
 * appears to not propagate in this Playwright 1.60 + Next 15 setup, so we
 * call `page.emulateMedia` explicitly in `beforeEach`.
 */

import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

test('reduced-motion: media query is actually emulated', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'networkidle' })
  const matched = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  expect(matched).toBe(true)
})

test('reduced-motion: sidebar mascot does NOT cycle loop frames', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)

  const mascot = page.locator('[data-mascot-pose]').first()
  await expect(mascot).toBeVisible()
  // Sample frame indicators over a full LOOP_MS window
  const samples: string[] = []
  for (let i = 0; i < 4; i++) {
    const f = await mascot.locator('[data-mascot-frame]').first().getAttribute('data-mascot-frame')
    samples.push(f ?? '?')
    await page.waitForTimeout(300)
  }
  // All samples should be the same frame (no toggle)
  expect(new Set(samples).size).toBe(1)
})

test('reduced-motion: S4 particles do not animate (component opted out OR duration clamped)', async ({ page }) => {
  await page.goto('/scan/demo', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2_000)
  const circles = page.locator('svg[data-component="particles"] circle')
  const count = await circles.count()
  if (count === 0) {
    // Particles opted out entirely — preferred path.
    return
  }
  const durations = await circles.evaluateAll((els) =>
    els.map((el) => parseFloat(getComputedStyle(el).animationDuration) || 0),
  )
  const longRunning = durations.filter((d) => d > 0.05)
  expect(longRunning.length).toBe(0)
})

test('reduced-motion: dep graph still renders nodes (structure preserved)', async ({ page }) => {
  await page.goto('/scan/demo', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3_000)
  const graph = page.locator('svg[role="img"]')
  await expect(graph).toBeVisible()
  const nodeCount = await graph.locator('circle').count()
  expect(nodeCount).toBeGreaterThan(0)
})

test('reduced-motion: input focus does not run a perceptible pulse', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('mendel_pat', 'ghp_fakefortestonly_xxxxxxxxxxxxxxxxxxxx'))
  await page.goto('/scan/new', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const input = page.locator('input[type="url"]')
  await input.focus()
  const dur = await input.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) || 0)
  expect(dur).toBeLessThanOrEqual(0.05)
})
