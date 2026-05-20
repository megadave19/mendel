import { z } from 'zod'
import { Octokit } from '@octokit/rest'
import { llmComplete } from '@/lib/llm'

// ─── Schemas ────────────────────────────────────────────────────────────────

export const BreakingChangeSchema = z.object({
  symbol: z.string(),
  changeType: z.enum(['removed', 'renamed', 'signature-changed', 'behavior-changed']),
  description: z.string().max(500),
  sourceUrl: z.string().url(),
})

export type BreakingChange = z.infer<typeof BreakingChangeSchema>

const BreakingChangesResponseSchema = z.object({
  hasBreakingChanges: z.boolean(),
  breakingChanges: z.array(BreakingChangeSchema),
})

// ─── npm registry helpers ───────────────────────────────────────────────────

async function getNpmRepoUrl(packageName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`)
    if (!res.ok) return null
    const data = (await res.json()) as {
      repository?: string | { url?: string }
      homepage?: string
    }
    if (typeof data.repository === 'string') return data.repository
    if (data.repository?.url) return data.repository.url
    return data.homepage ?? null
  } catch {
    return null
  }
}

function extractGitHubCoords(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') }
}

// ─── GitHub release notes ───────────────────────────────────────────────────

async function fetchReleaseNotes(
  owner: string,
  repo: string,
  fromVersion: string,
  pat: string,
): Promise<{ notes: string; sourceUrl: string }> {
  const client = new Octokit({ auth: pat })
  const sourceUrl = `https://github.com/${owner}/${repo}/releases`

  try {
    const releases = await client.paginate(client.rest.repos.listReleases, {
      owner,
      repo,
      per_page: 50,
    })

    // Collect releases newer than fromVersion
    const relevant = releases.filter((r) => {
      const tag = r.tag_name.replace(/^v/, '')
      return r.body && tag > fromVersion
    })

    if (relevant.length === 0) return { notes: '', sourceUrl }

    const notes = relevant
      .slice(0, 20)
      .map((r) => `## ${r.tag_name}\n${r.body ?? ''}`)
      .join('\n\n')

    return { notes, sourceUrl }
  } catch {
    return { notes: '', sourceUrl }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function parseBreakingChanges(
  packageName: string,
  fromVersion: string,
  toVersion: string,
  pat: string,
): Promise<BreakingChange[]> {
  const repoUrl = await getNpmRepoUrl(packageName)
  if (!repoUrl) return []

  const coords = extractGitHubCoords(repoUrl)
  if (!coords) return []

  const { owner, repo } = coords
  const { notes, sourceUrl } = await fetchReleaseNotes(owner, repo, fromVersion, pat)
  if (!notes) return []

  const prompt = `
You are analyzing changelog / release notes for npm package "${packageName}" (upgrading from ${fromVersion} to ${toVersion}).

Extract all BREAKING CHANGES — changes that would cause existing code to fail or behave differently after upgrading.
Focus on: removed exports, renamed APIs, changed function signatures, changed default behavior.

Changelog content (truncated to 12000 chars):
${notes.slice(0, 12000)}

Return JSON:
{
  "hasBreakingChanges": true,
  "breakingChanges": [
    {
      "symbol": "exact export/function/class name",
      "changeType": "removed" | "renamed" | "signature-changed" | "behavior-changed",
      "description": "brief description of what changed (max 500 chars)",
      "sourceUrl": "${sourceUrl}"
    }
  ]
}

If there are no breaking changes return: { "hasBreakingChanges": false, "breakingChanges": [] }
`

  try {
    const result = await llmComplete(prompt, BreakingChangesResponseSchema, { maxTokens: 4096 })
    return result.breakingChanges
  } catch {
    return []
  }
}
