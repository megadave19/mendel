/**
 * v2.1 / F22 — E2E for the "Point at any API" inspector.
 *
 * Per V2_PLAN §F22 verification: "paste a known pair, assert the report
 * renders + permalink resolves." We mock /api/inspect + /api/inspect/[id]
 * via page.route so the test is fully offline + fast — the live API is
 * exercised by the unit tests on the lib and the dev-server smoke check
 * we did at landing time.
 */

import { test, expect } from '@playwright/test'

const SAMPLE_REPORT = {
  packageName: 'react',
  fromVersion: '17.0.0',
  toVersion: '18.0.0',
  generatedAt: '2026-06-01T09:00:00.000Z',
  breakingChanges: [],
  semanticDiff: {
    removedExports: [],
    signatureChanges: [
      { symbol: 'createContext', before: '(a) => any', after: '(a, b) => any' },
    ],
    newDeprecations: [],
    affectedSitesInRepo: [],
    coveragePercent: 100,
    unanalyzableSymbols: [],
    analysisTier: 'dts',
  },
  confidence: {
    overall: 70,
    bucket: 'medium',
    perBreakingChange: [
      { symbol: 'createContext', score: 70, signalsAgreeing: ['semantic_diff'], tag: 'undocumented breaking change' },
    ],
    perPatchedFile: [],
    analysisCoverage: { symbolsAnalyzed: 1, symbolsTotal: 1, percentCovered: 100, analysisTier: 'dts', notAnalyzed: [] },
    verificationCapped: false,
    smokeCapped: false,
  },
  structuralCap: null,
  errors: ['changelog: signal skipped (no GitHub PAT supplied — anonymous rate limit too tight)'],
}

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('mendel_pat', 'ghp_fakefortestonly_xxxxxxxxxxxxxxxxxxxx')
  })
})

test('inspect: paste a pair → report renders + permalink resolves', async ({ page }) => {
  // Mock POST /api/inspect — returns the canned report + a fake id.
  await page.route('**/api/inspect', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'cmtest-react-17-18', report: SAMPLE_REPORT }),
    })
  })
  // Mock GET /api/inspect/[id] for the permalink page.
  await page.route('**/api/inspect/cmtest-react-17-18', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'cmtest-react-17-18',
        packageName: SAMPLE_REPORT.packageName,
        fromVersion: SAMPLE_REPORT.fromVersion,
        toVersion: SAMPLE_REPORT.toVersion,
        createdAt: '2026-06-01T09:00:00.000Z',
        report: SAMPLE_REPORT,
      }),
    })
  })

  await page.goto('/inspect', { waitUntil: 'networkidle' })

  // Fill the form. Aria-labels make the inputs queryable.
  await page.getByLabel('Package name').fill('react')
  await page.getByLabel('From version').fill('17.0.0')
  await page.getByLabel('To version').fill('18.0.0')
  await page.getByRole('button', { name: /Inspect →/i }).click()

  // Report panel header carries the pkg@from→to string.
  await expect(page.getByText(/react 17\.0\.0 → 18\.0\.0/)).toBeVisible()

  // The per-symbol finding lands in the page.
  await expect(page.getByText('createContext')).toBeVisible()

  // The "Not Analyzed" callout names the cap reason — honest about what
  // wasn't done (§5b).
  await expect(page.getByText(/No verification — Phase B/i)).toBeVisible()

  // The permalink button shows once the id lands. Clicking it should
  // expose a way to land on /inspect/<id>.
  const permalinkText = page.getByText('/inspect/cmtest-react-17-18')
  await expect(permalinkText).toBeVisible()

  // Permalink resolves (navigate directly — exercises GET /api/inspect/[id]).
  await page.goto('/inspect/cmtest-react-17-18', { waitUntil: 'networkidle' })
  await expect(page.getByText(/react 17\.0\.0 → 18\.0\.0/).first()).toBeVisible()
  await expect(page.getByText('createContext')).toBeVisible()
})

test('inspect: refuses identical versions (§5b — no misleading empty report)', async ({ page }) => {
  await page.goto('/inspect', { waitUntil: 'networkidle' })
  await page.getByLabel('Package name').fill('react')
  await page.getByLabel('From version').fill('18.0.0')
  await page.getByLabel('To version').fill('18.0.0')
  const button = page.getByRole('button', { name: /Inspect →/i })
  await expect(button).toBeDisabled()
})
