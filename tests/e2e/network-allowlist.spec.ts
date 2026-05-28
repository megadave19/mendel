/**
 * v1.5 Workstream #8 Push 2 E2E — sandbox network allowlist UI is functional,
 * not a dead control (CLAUDE.md §7.2a). Verifies:
 *
 *   1. Settings: tier-1 chips render read-only; adding a tier-2 host writes
 *      localStorage `mendel:pref:tier2AllowlistHosts`; removing clears it.
 *   2. Settings: invalid hostnames are rejected inline (never silently saved).
 *   3. New Scan: the advanced section seeds from the saved default and POSTs
 *      `tier2AllowlistHosts` to /api/scans.
 *   4. New Scan: a per-scan addition is included; the saved default is NOT
 *      mutated (override is scoped to the scan).
 */

import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 } })

const PREF_KEY = 'mendel:pref:tier2AllowlistHosts'

test('Settings: add + persist a tier-2 host, reject invalid input', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })

  // Tier-1 default chips present + read-only (informational).
  await expect(page.getByText('registry.npmjs.org').first()).toBeVisible()

  const input = page.getByLabel('Add a tier-2 allowlist host')
  await expect(input).toBeVisible()

  // Invalid host → inline error, nothing persisted. Scope to <p role=alert>
  // because Next.js renders its own div[role=alert] route announcer.
  await input.fill('not a host; rm -rf /')
  await page.getByRole('button', { name: /^add$/i }).click()
  await expect(page.locator('p[role="alert"]')).toBeVisible()
  let stored = await page.evaluate((k) => localStorage.getItem(k), PREF_KEY)
  expect(stored).toBeNull()

  // Valid host → persisted as JSON array.
  await input.fill('cdn.example.com')
  await page.getByRole('button', { name: /^add$/i }).click()
  await page.waitForTimeout(150)
  stored = await page.evaluate((k) => localStorage.getItem(k), PREF_KEY)
  expect(stored).toBe(JSON.stringify(['cdn.example.com']))

  // Chip is visible; remove clears the saved list.
  await expect(page.getByText('cdn.example.com').first()).toBeVisible()
  await page.getByRole('button', { name: /Remove cdn\.example\.com/i }).click()
  await page.waitForTimeout(150)
  stored = await page.evaluate((k) => localStorage.getItem(k), PREF_KEY)
  expect(stored).toBe(JSON.stringify([]))
})

test('Settings: a tier-1 host is rejected as a tier-2 addition (already covered)', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await page.getByLabel('Add a tier-2 allowlist host').fill('registry.npmjs.org')
  await page.getByRole('button', { name: /^add$/i }).click()
  await expect(page.locator('p[role="alert"]')).toContainText(/tier-1/i)
  const stored = await page.evaluate((k) => localStorage.getItem(k), PREF_KEY)
  expect(stored).toBeNull()
})

test('New Scan: seeds default allowlist + POSTs tier2AllowlistHosts', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('mendel_pat', 'ghp_fakefortestonly_xxxxxxxxxxxxxxxxxxxx')
    localStorage.setItem('mendel:pref:tier2AllowlistHosts', JSON.stringify(['cdn.example.com']))
  })
  await page.goto('/scan/new', { waitUntil: 'networkidle' })

  // The saved default auto-expands the advanced section + shows the chip.
  await expect(page.getByText('cdn.example.com').first()).toBeVisible()

  // Add a second host scoped to this scan.
  await page.getByLabel("Add a host to this scan's allowlist").fill('assets.example.org')
  await page.getByRole('button', { name: /^add$/i }).click()
  await page.waitForTimeout(150)

  let postBody: unknown = null
  await page.route('**/api/scans', (route) => {
    if (route.request().method() === 'POST') {
      try { postBody = JSON.parse(route.request().postData() ?? '{}') } catch { postBody = null }
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: 'cmstub_allowlist_test_x0001' }) })
    }
    return route.continue()
  })

  await page.locator('input[type="url"]').fill('https://github.com/megadave19/mendel-test')
  await page.getByRole('button', { name: /^scan/i }).click()
  await page.waitForTimeout(500)

  const hosts = (postBody as { tier2AllowlistHosts?: string[] }).tier2AllowlistHosts
  expect(hosts).toEqual(['cdn.example.com', 'assets.example.org'])

  // The saved default must NOT have been mutated by the per-scan add.
  const stored = await page.evaluate(() => localStorage.getItem('mendel:pref:tier2AllowlistHosts'))
  expect(stored).toBe(JSON.stringify(['cdn.example.com']))
})

test('New Scan: omits tier2AllowlistHosts when the user has no allowlist', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('mendel_pat', 'ghp_fakefortestonly_xxxxxxxxxxxxxxxxxxxx')
  })
  await page.goto('/scan/new', { waitUntil: 'networkidle' })

  let postBody: Record<string, unknown> | null = null
  await page.route('**/api/scans', (route) => {
    if (route.request().method() === 'POST') {
      try { postBody = JSON.parse(route.request().postData() ?? '{}') } catch { postBody = null }
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: 'cmstub_allowlist_test_x0002' }) })
    }
    return route.continue()
  })

  await page.locator('input[type="url"]').fill('https://github.com/megadave19/mendel-test')
  await page.getByRole('button', { name: /^scan/i }).click()
  await page.waitForTimeout(500)

  expect(postBody).toBeTruthy()
  expect(postBody).not.toHaveProperty('tier2AllowlistHosts')
})
