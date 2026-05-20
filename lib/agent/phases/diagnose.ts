import { z } from 'zod'
import { existsSync, readdirSync } from 'fs'
import path from 'path'
import { llmComplete } from '@/lib/llm'
import type { BreakingChange } from '@/lib/agent/signals/changelog'
import type { StaleDep } from './detect'

// ─── Schema ──────────────────────────────────────────────────────────────────

export const DiagnosisSchema = z.object({
  summary: z.string().transform((s) => s.slice(0, 500)),
  impact: z.string().transform((s) => s.slice(0, 1000)),
  filesToModify: z.array(z.string()).max(3),
  patchStrategy: z.string().transform((s) => s.slice(0, 1000)),
})

export type Diagnosis = z.infer<typeof DiagnosisSchema>

// ─── Helpers ─────────────────────────────────────────────────────────────────

function listSourceFiles(repoPath: string): string[] {
  const srcDir = path.join(repoPath, 'src')
  if (!existsSync(srcDir)) return []
  try {
    return readdirSync(srcDir, { recursive: true })
      .filter((f): f is string => typeof f === 'string')
      .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
      .map((f) => `src/${f}`)
      .slice(0, 20)
  } catch {
    return []
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function diagnoseIssue(
  dep: StaleDep,
  breakingChanges: BreakingChange[],
  repoPath: string,
  emit: (msg: string) => void,
): Promise<Diagnosis> {
  emit(`Diagnosing ${dep.name} (${dep.currentVersion} → ${dep.latestVersion})...`)

  const sourceFiles = listSourceFiles(repoPath)
  const breakingText =
    breakingChanges.length > 0
      ? breakingChanges
          .map((bc) => `- ${bc.symbol} (${bc.changeType}): ${bc.description}`)
          .join('\n')
      : `Major version bump (${dep.currentVersion} → ${dep.latestVersion}) — breaking changes are expected.`

  const prompt = `
You are analyzing a TypeScript project that needs to upgrade the npm package "${dep.name}" from ${dep.currentVersion} to ${dep.latestVersion}.

Breaking changes identified:
${breakingText}

Source files in this project:
${['package.json', ...sourceFiles].join('\n')}

Task:
1. Summarize what this upgrade breaks
2. Describe the impact on the codebase
3. List which files need to be modified (max 3, always include package.json first)
4. Describe the patch strategy step by step

Return JSON:
{
  "summary": "one sentence summary of what breaks",
  "impact": "what functionality is affected and the risk level",
  "filesToModify": ["package.json", "src/file.ts"],
  "patchStrategy": "step-by-step description of how to fix the upgrade"
}
`

  return llmComplete(prompt, DiagnosisSchema, { maxTokens: 4096 })
}
