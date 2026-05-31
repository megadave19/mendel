/**
 * 2026-05-31 — E2E coverage for the "Show mascot" + "Reduce motion" Settings
 * toggles. Created in response to a real user-reported bug: both toggles
 * fired a toast but did NOTHING — the §7.2a "dead control" class of issue.
 *
 * Specifically NOT covered by my earlier tests:
 *   - tests/e2e/smoke.spec.ts walks auth/scan/fix — never visits Settings
 *   - tests/e2e/visual.spec.ts snapshots static pages — a broken toggle
 *     renders pixel-identical to a working one until interacted with
 *   - tests/e2e/reduced-motion.spec.ts emulates the OS prefers-reduced-motion
 *     media query (which CSS responds to) — does NOT test the in-app toggle
 *
 * These tests prove BOTH toggles have observable downstream effect:
 *   1. Toggle the control on /settings
 *   2. Navigate to a page that should reflect it
 *   3. Assert the DOM actually changed
 */

import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 } })

// Playwright gives each test its own BrowserContext → fresh localStorage by
// default. We DO seed a fake PAT in sessionStorage so /settings doesn't
// redirect to /connect (the auth gate). addInitScript runs on every
// navigation but sessionStorage.setItem is idempotent — unlike a
// localStorage.clear() which would wipe the toggle writes between pages.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('mendel_pat', 'ghp_fakefortestonly_xxxxxxxxxxxxxxxxxxxx')
  })
})

test('Show mascot OFF actually hides the sidebar mascot (closes §7.2a dead-control bug)', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })

  // Default state: mascot visible. data-mascot-slot is set on the sidebar
  // mascot wrapper by AppNav so we can disambiguate from the page-level
  // mascots used in S1/S4.
  const slot = page.locator('[data-mascot-slot="visible"]')
  await expect(slot).toBeVisible()

  // Toggle off.
  const toggle = page.getByRole('switch', { name: /Show mascot/i })
  await toggle.click()

  // localStorage should now read '0'.
  const stored = await page.evaluate(() => window.localStorage.getItem('mendel:pref:mascot'))
  expect(stored).toBe('0')

  // <html> data attribute should reflect immediately (live notify path).
  await expect(page.locator('html')).toHaveAttribute('data-mascot', '0')

  // The sidebar mascot DOM should be absent (not just hidden via CSS).
  await expect(slot).toHaveCount(0)
})

test('Show mascot survives navigation — toggle off persists to next page', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: /Show mascot/i }).click()

  // Hard-navigate to dashboard; prefs-init.js applies the data attr BEFORE
  // React paints so there's no flash of the mascot.
  await page.goto('/dashboard', { waitUntil: 'networkidle' })
  await expect(page.locator('html')).toHaveAttribute('data-mascot', '0')
  await expect(page.locator('[data-mascot-slot="visible"]')).toHaveCount(0)
})

test('Reduce motion ON applies the CSS rule (animation-duration ~ 0)', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })

  // Default: not reduced. Sanity check we have SOMETHING animating on the
  // sidebar (the mascot wrapper inherits the global * animation rules even
  // when its own animation is via Framer Motion — we assert the html attr
  // and the cascading effect on a known-animating element).
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', '0')

  // Toggle ON.
  await page.getByRole('switch', { name: /Reduce motion/i }).click()

  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', '1')
  const stored = await page.evaluate(() => window.localStorage.getItem('mendel:pref:reduceMotion'))
  expect(stored).toBe('1')

  // The global CSS rule sets animation-duration to 0.01ms on every element.
  // Pick a known target: the BonesMascot SVG/div which has Framer Motion +
  // CSS animations. Computed style should report a near-zero animation duration.
  const slotAnimDur = await page.evaluate(() => {
    const el = document.querySelector('[data-mascot-slot="visible"]')
    if (!el) return null
    return getComputedStyle(el).animationDuration
  })
  // Either "0.01ms" (from our override) or "0s" (no animation on that element)
  // — both are acceptable. What's NOT acceptable is a multi-second value, which
  // would indicate the CSS rule didn't apply.
  if (slotAnimDur !== null) {
    // The cap is 0.01ms (10^-5s) per globals.css when [data-reduce-motion="1"].
    // Browsers stringify this as "0.01ms", "0s", OR "1e-05s" (scientific
    // notation on Chromium). All three mean "effectively no animation."
    // Parse to a number and assert it's well under one frame (16ms).
    const ms = parseAnimationDurationMs(slotAnimDur)
    expect(ms).toBeLessThan(16)
  }
})

// Helper kept inline — only this test needs it. Parses CSS animation-duration
// in whatever string form getComputedStyle returns and yields a number in ms.
function parseAnimationDurationMs(s: string): number {
  const trimmed = s.trim().toLowerCase()
  if (trimmed.endsWith('ms')) return Number(trimmed.slice(0, -2))
  if (trimmed.endsWith('s'))  return Number(trimmed.slice(0, -1)) * 1000
  // No unit (shouldn't happen, but treat as ms).
  return Number(trimmed)
}

test('Reduce motion survives navigation (no-flash hydration via prefs-init.js)', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: /Reduce motion/i }).click()

  await page.goto('/dashboard', { waitUntil: 'networkidle' })
  // No React effect race — data attr should be present before first paint.
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', '1')
})

test('toggles cross-tab via storage event (one tab off → other tab also off)', async ({ context }) => {
  // Sanity that we use the standard storage event, not custom-only. Covers
  // a future regression where someone removes the cross-tab path and
  // breaks Settings-in-one-tab → Dashboard-in-another.
  const tabA = await context.newPage()
  const tabB = await context.newPage()
  await tabA.goto('/settings', { waitUntil: 'networkidle' })
  await tabB.goto('/dashboard', { waitUntil: 'networkidle' })

  // Sanity start state — both tabs see mascot=1.
  await expect(tabB.locator('html')).toHaveAttribute('data-mascot', '1')

  // Write the pref directly in tab A's localStorage (bypasses the same-tab
  // custom event so we're testing the storage event path specifically).
  await tabA.evaluate(() => {
    window.localStorage.setItem('mendel:pref:mascot', '0')
    // The storage event fires in OTHER tabs only — that's exactly what we want
    // to test, so we don't dispatch our custom event here.
  })

  // Tab B's mascot should disappear via the storage-event listener.
  await expect(tabB.locator('[data-mascot-slot="visible"]')).toHaveCount(0, { timeout: 3000 })
})
