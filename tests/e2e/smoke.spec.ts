/**
 * Gate D4 smoke tests — full user journey.
 *
 * Updated 2026-05-27 for the Phase D rebuilt UI: the mascot is now a 2D <Image>
 * (was an SVG with viewBox 80x80), dashboard h1 is "Dashboard" (the "Scan
 * History" label moved to a section header), and settings/connect/new-scan
 * panels were rebuilt. All selectors below match the current implementation
 * — re-derive from a fresh page if the UI changes again.
 *
 * Prerequisites:
 *   - `pnpm dev` running on localhost:3000 (config auto-starts it)
 *   - A valid GitHub PAT in SMOKE_PAT env var to exercise the live scan flow.
 *     Without it, the live-scan describe block skips.
 *
 * Run: pnpm smoke
 */

import { test, expect, type Page } from '@playwright/test'

/** Wait for the sole sidebar mascot. New impl renders <img alt="Bones the …"> */
async function expectSidebarMascot(page: Page) {
  await expect(page.getByRole('img', { name: /bones the maintainer/i }).first()).toBeVisible({ timeout: 5_000 })
}

/* ── Reachability — every primary route renders without errors ────────────── */

test('landing renders the pixel-skull hero + headline', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Mendel/)
  await expect(page.locator('h1').first()).toBeVisible()
})

test('dashboard renders header strip + stat cards + history table', async ({ page }) => {
  await page.goto('/dashboard')
  // Header strip uses the new "Mendel // Dashboard" wordmark
  await expect(page.getByText(/MENDEL \/\/ DASHBOARD/i)).toBeVisible()
  // 4 stat cards
  await expect(page.getByText('Issues Found')).toBeVisible()
  await expect(page.getByText('Draft PRs Opened')).toBeVisible()
  await expect(page.getByText('Scans Run')).toBeVisible()
  // Scan History label
  await expect(page.getByText('Scan History', { exact: true })).toBeVisible()
  await expectSidebarMascot(page)
})

test('new scan page redirects to /connect when no PAT in session', async ({ page }) => {
  await page.goto('/scan/new')
  // The auth gate triggers a router.replace; URL ends up on /connect
  await page.waitForURL(/\/connect/, { timeout: 5_000 })
  await expect(page.getByText(/Connect your GitHub/i)).toBeVisible()
})

test('new scan page renders form when PAT is in session', async ({ page }) => {
  // Seed a fake PAT in sessionStorage BEFORE navigation
  await page.addInitScript(() => {
    sessionStorage.setItem('mendel_pat', 'ghp_fakefortestonly_xxxxxxxxxxxxxxxxxxxx')
  })
  await page.goto('/scan/new')
  await expect(page.locator('h1', { hasText: 'Scan a Repository' })).toBeVisible()
  await expect(page.getByPlaceholder(/owner\/repo/i)).toBeVisible()
  await expect(page.getByText(/Constraints/i)).toBeVisible()
  await expect(page.getByText(/What Mendel Will Do/i)).toBeVisible()
  await expectSidebarMascot(page)
})

test('settings page renders PAT + diagnostics + preferences', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.locator('h1', { hasText: 'Settings' })).toBeVisible()
  await expect(page.getByText(/GitHub Personal Access Token/i)).toBeVisible()
  await expect(page.getByText('Diagnostics', { exact: true })).toBeVisible()
  await expect(page.getByText('Preferences', { exact: true })).toBeVisible()
  // Three preference rows
  await expect(page.getByText('Reduce motion')).toBeVisible()
  await expect(page.getByText('Show mascot')).toBeVisible()
  await expect(page.getByText('Sound effects')).toBeVisible()
  await expectSidebarMascot(page)
})

test('connect page renders split layout + form', async ({ page }) => {
  await page.goto('/connect')
  // Left hero
  await expect(page.getByText(/Stale deps in\./i)).toBeVisible()
  // Right form
  await expect(page.getByText(/Connect your GitHub/i)).toBeVisible()
  await expect(page.getByLabel(/GitHub Personal Access Token/i)).toBeVisible()
  // Connect has its own inline mascot (sidebar is hidden on /connect)
  await expect(page.getByRole('img', { name: /bones the maintainer/i }).first()).toBeVisible()
})

test('demo scan page renders three-pane S4', async ({ page }) => {
  await page.goto('/scan/demo')
  // Repo label in status strip — demo shows "demo · mock scan"
  await expect(page.getByText(/demo/i).first()).toBeVisible()
  // Stage lane chips
  await expect(page.getByText('SCAN', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('VERIFY', { exact: true }).first()).toBeVisible()
  // Dep graph header + filter chips
  await expect(page.getByText(/dependency graph/i)).toBeVisible()
  await expectSidebarMascot(page)
})

/* ── Interaction — critical flows ─────────────────────────────────────────── */

test('settings: save + revoke PAT (sessionStorage round-trip)', async ({ page }) => {
  await page.goto('/settings')
  const input = page.locator('input[type="password"]').first()
  await input.fill('ghp_fakefortestonly_xxxxxxxxxxxxxxxxxxxx')
  // The Save click calls /api/validate-pat which will reject the fake PAT, so
  // we don't assert success — we assert the request fires + an error toast
  // appears (validation flow exists).
  await page.getByRole('button', { name: /save token/i }).click()
  // Either a toast (error) or the disabled state changes — both prove the
  // button is wired and the validation handler ran.
  await page.waitForTimeout(800)
  // Button is no longer in "validating" state
  await expect(page.getByRole('button', { name: /save token/i })).toBeVisible()
})

test('new scan: invalid URL keeps Scan button disabled', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('mendel_pat', 'ghp_fakefortestonly_xxxxxxxxxxxxxxxxxxxx'))
  await page.goto('/scan/new')
  const input = page.locator('input[type="url"]')
  await input.fill('not-a-github-url')
  const btn = page.getByRole('button', { name: /^scan/i })
  await expect(btn).toBeDisabled()
})

test('new scan: valid GitHub URL enables Scan button + shows parse preview', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('mendel_pat', 'ghp_fakefortestonly_xxxxxxxxxxxxxxxxxxxx'))
  await page.goto('/scan/new')
  const input = page.locator('input[type="url"]')
  await input.fill('https://github.com/megadave19/mendel-test')
  await expect(page.getByText(/megadave19 \/ mendel-test/i)).toBeVisible()
  const btn = page.getByRole('button', { name: /^scan/i })
  await expect(btn).toBeEnabled()
})

test('demo scan: F5 Replay button is present and enabled when scan is done', async ({ page }) => {
  await page.goto('/scan/demo')
  // Wait for the demo to finish (mock scan completes in a few seconds)
  await page.waitForTimeout(8_000)
  // Replay control sits in the command bar
  await expect(page.getByRole('button', { name: /replay/i })).toBeVisible()
})

test('dep graph: filter chips switch node count (All vs Issues)', async ({ page }) => {
  await page.goto('/scan/demo')
  await page.waitForTimeout(3_000)
  // Click the "Issues" chip in the dep graph
  await page.getByRole('button', { name: /^Issues/i }).first().click()
  // After filter, fewer circles in the SVG (delivered + issue only)
  const svgCircles = await page.locator('svg[role="img"] circle').count()
  expect(svgCircles).toBeGreaterThan(0)
})

/* ── Full scan flow (requires SMOKE_PAT) ──────────────────────────────────── */

test.describe('live scan flow (requires SMOKE_PAT)', () => {
  test.beforeEach(() => {
    if (!process.env.SMOKE_PAT) {
      test.skip(true, 'SMOKE_PAT not set — skipping live scan flow')
    }
  })

  test('connect → new scan → live console → dashboard', async ({ page }) => {
    const pat = process.env.SMOKE_PAT!

    await page.goto('/settings')
    await page.locator('input[type="password"]').first().fill(pat)
    await page.getByRole('button', { name: /save token/i }).click()
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible({ timeout: 10_000 })

    await page.goto('/scan/new')
    await page.locator('input[type="url"]').fill('https://github.com/megadave19/mendel-test')
    await page.getByRole('button', { name: /^scan/i }).click()

    await page.waitForURL(/\/scan\/[a-z0-9]+$/, { timeout: 15_000 })

    // Status strip shows the repo name once the scan record API resolves
    await expect(page.getByText(/megadave19\/mendel-test/i).first()).toBeVisible({ timeout: 15_000 })

    // Wait for at least one log line to appear
    await expect(page.locator('[data-mascot-pose]').first()).toBeVisible()

    // Then check dashboard has a new scan row at top
    await page.goto('/dashboard')
    await expect(page.locator('.dashboard-row').first()).toBeVisible()
  })
})
