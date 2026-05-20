/**
 * Gate 1D smoke tests — full user journey
 *
 * Prerequisites:
 *   - `pnpm dev` running on localhost:3000
 *   - A valid GitHub PAT with `repo` scope available to paste in the test
 *     (reads from env SMOKE_PAT, falls back to skipping the scan flow)
 *
 * Run: pnpm smoke
 */

import { test, expect, Page } from '@playwright/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wait for the skull mascot to appear (any state) */
async function expectMascot(page: Page) {
  // The skull SVG is always rendered inside a <div> wrapping a <motion.div>
  await expect(page.locator('svg[viewBox="0 0 80 80"]').first()).toBeVisible()
}

// ── 1. Landing page reachable ────────────────────────────────────────────────

test('landing page loads with correct heading', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Mendel/)
  // Glitch h1 contains MENDEL
  const h1 = page.locator('h1').first()
  await expect(h1).toBeVisible()
  await expect(h1).toContainText('MENDEL')
  await expectMascot(page)
})

// ── 2. Navigation — all app screens reachable ────────────────────────────────

test('dashboard page loads', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.locator('h1')).toContainText('Scan History')
  await expectMascot(page)
})

test('new scan page loads', async ({ page }) => {
  await page.goto('/scan/new')
  await expect(page.locator('h1')).toContainText('Scan a Repository')
  await expectMascot(page)
})

test('settings page loads', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.locator('h1')).toContainText('Settings')
  await expectMascot(page)
})

// ── 3. PAT entry / settings flow ────────────────────────────────────────────

test('settings: save and revoke PAT', async ({ page }) => {
  await page.goto('/settings')

  const input = page.locator('input[type="password"]')
  await input.fill('ghp_testtoken12345678901234567890123456')
  await page.getByRole('button', { name: /save token/i }).click()

  // Should show "Active" badge
  await expect(page.locator('text=Active')).toBeVisible()

  // Revoke
  await page.getByRole('button', { name: /revoke/i }).click()
  await expect(page.locator('text=Active')).not.toBeVisible()
})

// ── 4. New scan page — URL validation ────────────────────────────────────────

test('new scan: invalid URL keeps button disabled', async ({ page }) => {
  await page.goto('/scan/new')
  const input = page.locator('input[type="url"]')
  await input.fill('not-a-github-url')
  const btn = page.getByRole('button', { name: /scan/i })
  await expect(btn).toBeDisabled()
})

test('new scan: valid GitHub URL enables button and shows parsed preview', async ({ page }) => {
  await page.goto('/scan/new')
  const input = page.locator('input[type="url"]')
  await input.fill('https://github.com/megadave19/mendel-test')

  // Parsed preview should appear
  await expect(page.locator('text=megadave19 / mendel-test')).toBeVisible()

  // Scan button should be enabled
  const btn = page.getByRole('button', { name: /scan/i })
  await expect(btn).toBeEnabled()
})

// ── 5. Dashboard shows past scans ────────────────────────────────────────────

test('dashboard: shows scan rows if any exist', async ({ page }) => {
  await page.goto('/dashboard')
  // Either shows the empty state or at least one scan row — both are valid
  const emptyState = page.locator('text=No scans yet')
  const scanRow = page.locator('a[href^="/scan/"]').first()

  // One of them must be visible
  const hasEmpty = await emptyState.isVisible().catch(() => false)
  const hasRow = await scanRow.isVisible().catch(() => false)
  expect(hasEmpty || hasRow).toBe(true)
})

// ── 6. Full scan flow (requires SMOKE_PAT env var) ───────────────────────────

test.describe('scan flow (requires SMOKE_PAT)', () => {
  test.beforeEach(({ page: _ }) => {
    if (!process.env.SMOKE_PAT) {
      test.skip(true, 'SMOKE_PAT not set — skipping live scan flow')
    }
  })

  test('connect → new scan → live console renders events → dashboard updated', async ({ page }) => {
    const pat = process.env.SMOKE_PAT!

    // Store PAT via settings page (sessionStorage)
    await page.goto('/settings')
    await page.locator('input[type="password"]').fill(pat)
    await page.getByRole('button', { name: /save token/i }).click()
    await expect(page.locator('text=Active')).toBeVisible()

    // Navigate to new scan
    await page.goto('/scan/new')
    await page.locator('input[type="url"]').fill('https://github.com/megadave19/mendel-test')
    await page.getByRole('button', { name: /scan/i }).click()

    // Should navigate to /scan/[id]
    await page.waitForURL(/\/scan\/[a-z0-9-]+$/, { timeout: 10_000 })
    expect(page.url()).toMatch(/\/scan\/[a-z0-9-]+$/)

    // Live console should render — at least "connected" indicator or first log entry
    // The connection indicator is a cyan pulsing dot; check for the console wrapper
    await expect(page.locator('text=Live Console')).toBeVisible({ timeout: 10_000 })

    // Wait up to 90s for at least one terminal line to appear (phase/log events)
    await expect(page.locator('[style*="font-family: var(--font-mono)"]').nth(2))
      .toBeVisible({ timeout: 90_000 })

    // Navigate to dashboard — should have at least one scan row now
    await page.goto('/dashboard')
    await expect(page.locator('a[href^="/scan/"]').first()).toBeVisible()
  })
})
