/**
 * v1.5 W#10 — E2E for the rejection API + UI affordance.
 *
 * Verifies:
 *   - POST /api/rejections accepts valid input, returns 201 on create + 200 on dedupe
 *   - POST rejects malformed input with 400
 *   - GET /api/rejections?dep=… returns matching patterns
 *   - The IssueCard "Mark as rejected" button is present on a PR-opened card
 *     (demo scan exercises this path)
 *
 * Cleans up its own rows via a final DELETE round-trip — but since /api
 * doesn't expose DELETE, we just use unique PR URLs scoped to this test.
 */

import { test, expect } from '@playwright/test'

const PR_PREFIX = 'https://github.com/test/rejection-api-e2e/pull/'

test('POST /api/rejections creates a new pattern (201)', async ({ request }) => {
  const res = await request.post('/api/rejections', {
    data: {
      depName: 'react-test-only',
      changeType: 'removed',
      rejectionReason: 'e2e test reason — caller relied on removed export',
      prUrl: PR_PREFIX + Date.now() + '-create',
    },
  })
  expect(res.status()).toBe(201)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.created).toBe(true)
  expect(body.id).toBeTruthy()
})

test('POST /api/rejections updates in place when prUrl is reused (200)', async ({ request }) => {
  const pr = PR_PREFIX + Date.now() + '-dedup'
  const first = await request.post('/api/rejections', {
    data: { depName: 'axios-test-only', rejectionReason: 'first reason', prUrl: pr },
  })
  expect(first.status()).toBe(201)
  const second = await request.post('/api/rejections', {
    data: { depName: 'axios-test-only', rejectionReason: 'updated second reason', prUrl: pr },
  })
  expect(second.status()).toBe(200)
  const body = await second.json()
  expect(body.created).toBe(false)
})

test('POST /api/rejections rejects malformed input (400)', async ({ request }) => {
  const res = await request.post('/api/rejections', {
    data: { depName: '', rejectionReason: '', prUrl: 'not-a-url' },
  })
  expect(res.status()).toBe(400)
  const body = await res.json()
  expect(body.error).toBeTruthy()
})

test('POST /api/rejections rejects non-github prUrl (400)', async ({ request }) => {
  const res = await request.post('/api/rejections', {
    data: {
      depName: 'whatever',
      rejectionReason: 'something invalid',
      prUrl: 'https://gitlab.com/x/y/-/merge_requests/1',
    },
  })
  expect(res.status()).toBe(400)
})

test('GET /api/rejections?dep=… returns recorded patterns', async ({ request }) => {
  const uniqueDep = `unique-dep-${Date.now()}`
  await request.post('/api/rejections', {
    data: {
      depName: uniqueDep,
      rejectionReason: 'reason captured by GET test',
      prUrl: PR_PREFIX + Date.now() + '-get',
    },
  })
  const res = await request.get(`/api/rejections?dep=${uniqueDep}`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.patterns)).toBe(true)
  expect(body.patterns.length).toBeGreaterThan(0)
  expect(body.patterns[0].depName).toBe(uniqueDep)
})

test('GET /api/rejections without dep returns 400', async ({ request }) => {
  const res = await request.get('/api/rejections')
  expect(res.status()).toBe(400)
})

test('IssueCard PR-opened state renders the Mark-as-rejected button (demo scan)', async ({ page }) => {
  await page.goto('/scan/demo')
  // Demo finishes in ~8s; cards expand on done. Demo issues don't auto-open
  // their PRs — the user must click "Open Draft PR" first. That's how the
  // real demo flow exercises S7. Click + then assert the button surfaces.
  await page.waitForTimeout(8_000)
  const openPrBtn = page.getByRole('button', { name: /open draft pr/i }).first()
  await expect(openPrBtn).toBeVisible({ timeout: 10_000 })
  await openPrBtn.click()
  // After click, the PR-opened state renders → "Mark as rejected" appears
  const btn = page.getByRole('button', { name: /mark as rejected/i }).first()
  await expect(btn).toBeVisible()
  await expect(btn).toBeEnabled()
})
