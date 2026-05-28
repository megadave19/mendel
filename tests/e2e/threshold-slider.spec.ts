/**
 * v1.5 Workstream #4 E2E — confidence threshold slider in Settings is
 * functional, not a fake control. Verifies:
 *
 *   1. The slider exists and has a real value
 *   2. Changing it writes localStorage `mendel:pref:confidenceThreshold`
 *   3. The displayed score updates live
 *   4. New Scan reads the threshold and attaches it to the /api/scans POST
 *
 * Per CLAUDE.md §7.2a "no dead controls": this slider must do something
 * observable. These tests prove it does.
 */

import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 } })

test('threshold slider in Settings writes localStorage + updates displayed score', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })

  const slider = page.getByLabel('Confidence threshold for standard PR submission')
  await expect(slider).toBeVisible()

  // Initial value (default 70 or whatever localStorage already holds).
  const initial = await slider.inputValue()
  expect(Number(initial)).toBeGreaterThanOrEqual(40)
  expect(Number(initial)).toBeLessThanOrEqual(100)

  // Move the slider to 85 via direct input (Playwright's `fill` on type=range).
  await slider.fill('85')
  await page.waitForTimeout(150) // let React state propagate + write to localStorage

  // Big number readout updates
  await expect(page.locator('text=/^85$/')).toBeVisible()

  // localStorage actually contains the new value
  const stored = await page.evaluate(() => localStorage.getItem('mendel:pref:confidenceThreshold'))
  expect(stored).toBe('85')

  // Reload — the slider should hydrate from localStorage to the same value
  await page.reload({ waitUntil: 'networkidle' })
  const after = await page.getByLabel('Confidence threshold for standard PR submission').inputValue()
  expect(after).toBe('85')
})

test('New Scan reads threshold from localStorage and attaches it to POST /api/scans', async ({ page }) => {
  // Seed the PAT (auth gate) + a non-default threshold.
  await page.addInitScript(() => {
    sessionStorage.setItem('mendel_pat', 'ghp_fakefortestonly_xxxxxxxxxxxxxxxxxxxx')
    localStorage.setItem('mendel:pref:confidenceThreshold', '65')
  })
  await page.goto('/scan/new', { waitUntil: 'networkidle' })

  // Intercept the POST and assert the body carries confidenceThreshold:65.
  let postBody: unknown = null
  await page.route('**/api/scans', (route) => {
    if (route.request().method() === 'POST') {
      try {
        postBody = JSON.parse(route.request().postData() ?? '{}')
      } catch {
        postBody = null
      }
      // Reply with a fake ID so the page doesn't error mid-navigation
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'cmstub_threshold_test_id_x000' }),
      })
    }
    return route.continue()
  })

  await page.locator('input[type="url"]').fill('https://github.com/megadave19/mendel-test')
  await page.getByRole('button', { name: /^scan/i }).click()
  // Wait for the request to fire + post handler to settle
  await page.waitForTimeout(500)

  expect(postBody).toBeTruthy()
  expect((postBody as { confidenceThreshold?: number }).confidenceThreshold).toBe(65)
  expect((postBody as { repoUrl?: string }).repoUrl).toContain('megadave19/mendel-test')
})

test('threshold slider visibly distinguishes bucket bands (lime / amber / red)', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  // The three band labels must all be present so the user sees the consequence
  // of moving the slider before they move it. Per spec — not just a number.
  await expect(page.getByText(/≥ threshold/i)).toBeVisible()
  await expect(page.getByText(/40 to threshold/i)).toBeVisible()
  await expect(page.getByText(/below 40/i)).toBeVisible()
  // Text appears in multiple places (band detail + the bigger "minimum for
  // standard PR" caption) — use `.first()` since we only need to assert
  // presence somewhere in the panel.
  await expect(page.getByText(/standard PR/i).first()).toBeVisible()
  await expect(page.getByText(/Draft PR/i).first()).toBeVisible()
  await expect(page.getByText(/no PR opened/i).first()).toBeVisible()
})
