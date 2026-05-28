/**
 * README/portfolio screenshot generator (not a test — it asserts nothing
 * meaningful; it captures clean full-app screenshots into docs/screenshots/).
 *
 * Run with: pnpm smoke _capture-screenshots
 * Re-run any time the UI changes to refresh the README imagery.
 *
 * Unlike visual.spec.ts these are UNMASKED (the mascot + all data render for
 * real) so the images look like the running product, not a regression diff.
 */

import { test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'docs', 'screenshots')
mkdirSync(OUT, { recursive: true })

test.use({ viewport: { width: 1512, height: 945 } })

// Seed: connected PAT (passes the New-Scan auth gate), mascot on, a saved
// tier-2 allowlist default so the New-Scan advanced panel renders expanded.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('mendel_pat', 'ghp_demo_screenshot_only_xxxxxxxxxxxx')
    localStorage.setItem('mendel:pref:mascotEnabled', '1')
    localStorage.setItem('mendel:pref:tier2AllowlistHosts', JSON.stringify(['cdn.jsdelivr.net']))
  })
})

async function settle(page: import('@playwright/test').Page, ms = 900) {
  await page.waitForTimeout(ms)
}

test('capture: landing', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await settle(page, 1200)
  await page.screenshot({ path: join(OUT, '01-landing.png') })
})

test('capture: dashboard', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'networkidle' })
  await settle(page, 1400) // let sparklines draw in
  await page.screenshot({ path: join(OUT, '02-dashboard.png') })
  await page.screenshot({ path: join(OUT, '02-dashboard-full.png'), fullPage: true })
})

test('capture: live console (scan demo)', async ({ page }) => {
  await page.goto('/scan/demo', { waitUntil: 'networkidle' })
  // Demo streams for ~8s then settles into issues with calibrated confidence.
  await settle(page, 9500)
  await page.screenshot({ path: join(OUT, '03-live-console.png') })
  await page.screenshot({ path: join(OUT, '03-live-console-full.png'), fullPage: true })
})

test('capture: new scan', async ({ page }) => {
  await page.goto('/scan/new', { waitUntil: 'networkidle' })
  await settle(page, 1000)
  await page.screenshot({ path: join(OUT, '04-new-scan.png') })
})

test('capture: settings', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await settle(page, 1000)
  await page.screenshot({ path: join(OUT, '05-settings.png') })
  await page.screenshot({ path: join(OUT, '05-settings-full.png'), fullPage: true })
})
