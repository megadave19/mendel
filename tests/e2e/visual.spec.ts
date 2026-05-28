/**
 * Gate D4 visual regression — baseline snapshots for every primary route.
 *
 * On first run, generates baselines under
 * `tests/e2e/visual.spec.ts-snapshots/`. Subsequent runs compare; CI fails on
 * pixel drift. To accept new baselines run:
 *
 *   pnpm smoke -- --update-snapshots visual.spec.ts
 *
 * Routes covered (Phase D inventory):
 *   1. /              — landing (PixelSkullHero)
 *   2. /connect       — split product hero + auth form
 *   3. /dashboard     — stat row + scan history + recent rail
 *   4. /scan/new      — URL form + constraints + recent rail
 *   5. /scan/demo     — Live Console three-pane
 *   6. /settings      — PAT + About + Diagnostics + Preferences
 *
 * Stability notes:
 *   - We seed a fake PAT into sessionStorage before /scan/new so the auth gate
 *     doesn't redirect to /connect.
 *   - We wait for the mascot's first frame to load before snapshot so the
 *     PNG decode doesn't race the screenshot.
 *   - Mascot's loop animation is deterministic (mulberry32 PRNG) so two
 *     same-second snapshots will match — but to remove any frame flicker we
 *     mask the mascot wrapper on routes where it's a stable presence.
 *   - The dep graph SVG is masked on /scan/demo because particle drift +
 *     graph drift is the entire point and would always diff.
 */

import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 } })

/* test.use({ reducedMotion }) does not propagate in this Playwright 1.60
   + Next 15 setup — emulate it explicitly per-test instead. Confirmed
   regression in tests/e2e/reduced-motion.spec.ts. */
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

const SETTLE_MS = 900

test('visual — landing', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(SETTLE_MS)
  await expect(page).toHaveScreenshot('landing.png', { fullPage: true, maxDiffPixelRatio: 0.02 })
})

test('visual — connect', async ({ page }) => {
  await page.goto('/connect', { waitUntil: 'networkidle' })
  await page.waitForTimeout(SETTLE_MS)
  await expect(page).toHaveScreenshot('connect.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
    mask: [page.getByRole('img', { name: /bones the maintainer/i })],
  })
})

test('visual — dashboard', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'networkidle' })
  // Wait extra for /api/scans round-trip + sparkline draw-in
  await page.waitForTimeout(SETTLE_MS + 400)
  await expect(page).toHaveScreenshot('dashboard.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.03, // sparkline pathLength tween can leave 1-px residue
    mask: [
      page.getByRole('img', { name: /bones the maintainer/i }),
      page.locator('.dashboard-row'), // dates are relative ("4d ago") and drift over time
    ],
  })
})

test('visual — new scan', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('mendel_pat', 'ghp_fakefortestonly_xxxxxxxxxxxxxxxxxxxx')
  })
  await page.goto('/scan/new', { waitUntil: 'networkidle' })
  await page.waitForTimeout(SETTLE_MS)
  await expect(page).toHaveScreenshot('new-scan.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
    mask: [
      page.getByRole('img', { name: /bones the maintainer/i }),
      page.locator('aside'), // recent-repos rail also has relative times
    ],
  })
})

test('visual — settings', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await page.waitForTimeout(SETTLE_MS)
  await expect(page).toHaveScreenshot('settings.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
    mask: [page.getByRole('img', { name: /bones the maintainer/i })],
  })
})

test('visual — scan demo (Live Console)', async ({ page }) => {
  await page.goto('/scan/demo', { waitUntil: 'networkidle' })
  // Demo mock scan ticks rapidly. Wait until DONE so layout settles.
  await page.waitForTimeout(8_000)
  await expect(page).toHaveScreenshot('scan-demo.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.06, // dep graph + particles still drift even with reduced-motion
    mask: [
      page.getByRole('img', { name: /bones the maintainer/i }),
      page.locator('svg[role="img"]'), // dep graph
      page.locator('svg[aria-hidden="true"]'), // particles layer
      page.locator('[class*="terminal"]'), // terminal log timestamps shift
    ],
  })
})
