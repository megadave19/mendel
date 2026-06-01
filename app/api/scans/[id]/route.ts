import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { applyRateLimit } from '@/lib/rate-limit'
import { dbIssueToVM } from '@/lib/agent/issue-vm'
import type { IssueVM } from '@/components/phase-d/types'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

  const { id } = await params
  const scan = await db.scan.findUnique({
    where: { id },
    select: {
      id: true,
      repoUrl: true,
      status: true,
      startedAt: true,
      completedAt: true,
      issuesFound: true,
      prsOpened: true,
      totalTokens: true,
      schemaVersion: true,
      deps: true,
      errorMessage: true,
      // v2.0 / F20 — drives the 5th StageLane on /scan/[id].
      smokeRequested: true,
      // v2.1 / F21 — workspace flavor; null on single-package + legacy scans.
      workspaceKind: true,
      // v2.1 / F21 — the per-package rows the UI needs for chips + mini-stats.
      packages: {
        select: {
          id: true, name: true, dir: true, manifestPath: true,
          depsCount: true, issuesFound: true, scanned: true, skipReason: true,
        },
        orderBy: { dir: 'asc' },
      },
      issues: true,
      // encryptedPat intentionally omitted — never returned to client
    },
  })

  if (!scan) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  }

  // Parse the persisted dep-name list (JSON string[]) for the dep graph.
  let deps: string[] = []
  try {
    if (scan.deps) deps = JSON.parse(scan.deps) as string[]
  } catch {
    deps = []
  }

  // v2.1 / F21 — join packageDir → packageName so the IssueCard chip can
  // render a friendly display name without the client having to do its own
  // lookup. We omit packageName for SINGLE-PACKAGE scans (one row with
  // dir='.') so the chip-suppression rule in IssueCard kicks in naturally.
  const dirToName = new Map<string, string>()
  const multiPackage = scan.packages.length > 1
  if (multiPackage) {
    for (const pkg of scan.packages) dirToName.set(pkg.dir, pkg.name)
  }
  const enrichedIssues = scan.issues.map((issue) => {
    const vm: IssueVM = dbIssueToVM(issue)
    if (vm.packageDir && dirToName.has(vm.packageDir)) {
      vm.packageName = dirToName.get(vm.packageDir)
    }
    return vm
  })

  const { issues: _issues, packages, ...rest } = scan
  void _issues
  return NextResponse.json({
    ...rest,
    deps,
    issues: enrichedIssues,
    // Drop the `packages` array entirely on single-package scans so the v1.5
    // UI behavior is unchanged (no chips, no monorepo mini-stats). Clients
    // should treat its absence as "single-package, no group rendering."
    packages: multiPackage ? packages : [],
  })
}
