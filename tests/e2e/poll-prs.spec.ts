/**
 * v1.5 W#10 Push 2 (a) E2E — automated PR-state polling.
 *
 * Verifies:
 *   - POST /api/poll-prs returns a summary (real endpoint, real DB; with no
 *     open Mendel PRs it returns zeros — never errors)
 *   - POST with a bad scanId shape is rejected 400 (Zod guard)
 *   - The Dashboard "Sync PR States" button is wired (§7.2a): clicking it
 *     fires POST /api/poll-prs and shows a result toast — not a dead control
 */

import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 } })

test('POST /api/poll-prs returns an ok summary with no open PRs', async ({ request }) => {
  const res = await request.post('/api/poll-prs', { data: {} })
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.summary).toBeTruthy()
  expect(typeof body.summary.checked).toBe('number')
  expect(Array.isArray(body.summary.errors)).toBe(true)
})

test('POST /api/poll-prs rejects a malformed scanId (400)', async ({ request }) => {
  const res = await request.post('/api/poll-prs', { data: { scanId: 12345 } })
  expect(res.status()).toBe(400)
})

test('Dashboard "Sync PR States" button is wired and fires the poll endpoint', async ({ page }) => {
  let posted = false
  await page.route('**/api/poll-prs', (route) => {
    if (route.request().method() === 'POST') {
      posted = true
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, summary: { checked: 2, merged: 1, rejected: 1, stillOpen: 0, skipped: 0, errors: [] } }),
      })
    }
    return route.continue()
  })

  await page.goto('/dashboard', { waitUntil: 'networkidle' })
  const btn = page.getByRole('button', { name: /sync pr states/i })
  await expect(btn).toBeVisible()
  await btn.click()

  await page.waitForTimeout(400)
  expect(posted).toBe(true)
  // Result toast surfaces the summary (checked/merged/rejected).
  await expect(page.getByText(/2 PRs · 1 merged · 1 rejected/i)).toBeVisible()
})
