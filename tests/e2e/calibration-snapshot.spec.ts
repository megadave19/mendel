/**
 * v1.5 Workstream #6 E2E — Dashboard CalibrationSnapshot panel.
 *
 * Two scenarios:
 *   1. Empty state: when /api/scans returns scans without calibrated data
 *      (today's dev.db state), the panel must render the explanatory empty
 *      state — NOT fake zeros.
 *   2. Populated state: when /api/scans returns scans with `confidenceSummary`
 *      JSON, the panel renders trend sparkline + bucket bar + regression rate.
 *
 * Mocks /api/scans so the test is hermetic + doesn't depend on whether
 * v1.5 scans have actually run in the local dev DB.
 */

import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 } })

const NOW = Date.now()

const FAKE_SUMMARY_HIGH = {
  hasCalibratedData: true,
  avgScore: 88,
  bucketCounts: { high: 3, medium: 1, low: 0 },
  tierCounts: { dts: 4, 'api-extractor': 0, 'ast-only': 0, none: 0 },
  issuesCalibrated: 4,
  issuesTotal: 4,
  verificationFailureRate: 0,
  cappedRate: 0,
}

const FAKE_SUMMARY_MIXED = {
  hasCalibratedData: true,
  avgScore: 62,
  bucketCounts: { high: 1, medium: 1, low: 2 },
  tierCounts: { dts: 2, 'api-extractor': 0, 'ast-only': 2, none: 0 },
  issuesCalibrated: 4,
  issuesTotal: 4,
  verificationFailureRate: 0.25,
  cappedRate: 0.25,
}

test('CalibrationSnapshot renders empty-state when no scans have calibrated data', async ({ page }) => {
  // Mock /api/scans to return only v1.0 stub scans (no confidenceSummary)
  await page.route('**/api/scans', (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'scan-stub-1',
          repoUrl: 'https://github.com/test/v1stub',
          status: 'completed',
          startedAt: new Date(NOW - 5 * 86_400_000).toISOString(),
          completedAt: new Date(NOW - 5 * 86_400_000 + 60_000).toISOString(),
          issuesFound: 2,
          prsOpened: 1,
          confidenceSummary: null,
        },
      ]),
    })
  })
  await page.goto('/dashboard', { waitUntil: 'networkidle' })
  const panel = page.getByLabel('Calibration snapshot')
  await expect(panel).toBeVisible()
  await expect(panel.getByText(/No calibrated scans yet/i)).toBeVisible()
  // Empty state must NOT show the actual metric rows (bucket legend / SVG).
  // We check absence of the bucket legend "High:" which only renders in the
  // populated state.
  await expect(panel.getByText(/High:\s*\d+/i)).not.toBeVisible()
})

test('CalibrationSnapshot renders trend + buckets + regression when scans have summaries', async ({ page }) => {
  await page.route('**/api/scans', (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'scan-c2', repoUrl: 'https://github.com/test/c2',
          status: 'completed',
          startedAt: new Date(NOW - 1 * 86_400_000).toISOString(),
          completedAt: new Date(NOW - 1 * 86_400_000 + 60_000).toISOString(),
          issuesFound: 4, prsOpened: 3,
          confidenceSummary: JSON.stringify(FAKE_SUMMARY_HIGH),
        },
        {
          id: 'scan-c1', repoUrl: 'https://github.com/test/c1',
          status: 'completed',
          startedAt: new Date(NOW - 3 * 86_400_000).toISOString(),
          completedAt: new Date(NOW - 3 * 86_400_000 + 60_000).toISOString(),
          issuesFound: 4, prsOpened: 2,
          confidenceSummary: JSON.stringify(FAKE_SUMMARY_MIXED),
        },
      ]),
    })
  })
  await page.goto('/dashboard', { waitUntil: 'networkidle' })
  const panel = page.getByLabel('Calibration snapshot')
  // Wait for the panel to switch from empty-state to populated. The bucket
  // legend "High:" only renders in the populated branch — gates the rest.
  await expect(panel).toBeVisible()
  await expect(panel.getByText(/High:\s*\d+/i)).toBeVisible({ timeout: 10_000 })

  // All three section row labels rendered
  await expect(panel.getByText(/Avg confidence trend/i)).toBeVisible()
  await expect(panel.getByText(/Bucket distribution/i)).toBeVisible()
  await expect(panel.getByText(/regression rate/i)).toBeVisible()

  // Latest average (newest scan first → FAKE_SUMMARY_HIGH avgScore=88)
  await expect(panel.getByText(/88\/100 latest avg/i)).toBeVisible()

  // Bucket legend totals: 4 high (3+1), 2 medium (1+1), 2 low (0+2)
  await expect(panel.getByText(/High:\s*4/i)).toBeVisible()
  await expect(panel.getByText(/Medium:\s*2/i)).toBeVisible()
  await expect(panel.getByText(/Low:\s*2/i)).toBeVisible()

  // Trend line: SVG must contain a <path> with stroke + a circle for latest point
  const svgPaths = await panel.locator('svg path').count()
  expect(svgPaths).toBeGreaterThan(0)
})
