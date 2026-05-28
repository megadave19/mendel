import { z } from 'zod'
import { existsSync, readdirSync } from 'fs'
import path from 'path'
import { llmComplete } from '@/lib/llm'
import type { BreakingChange } from '@/lib/agent/signals/changelog'
import type { StaleDep } from './detect'
import {
  recallRejectionPatterns,
  recallSimilarRejections,
  formatPatternsForPrompt,
  formatSimilarPatternsForPrompt,
} from '@/lib/agent/learning/rejection-recall'

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

  // v1.5 W#10 — pull rejection patterns for this dep. The most-relevant
  // changeType matches come first; depName-only fills the remainder. Failed
  // recall must NOT block diagnosis — we catch + log and continue (the
  // diagnose call is too important to fail on a learning-side issue).
  let priorRejections = ''
  try {
    const primaryChangeType = breakingChanges[0]?.changeType
    const patterns = await recallRejectionPatterns(dep.name, { changeType: primaryChangeType })
    if (patterns.length > 0) {
      emit(`Found ${patterns.length} prior rejection pattern(s) for ${dep.name} — feeding to diagnosis`)
      priorRejections = '\n\n' + formatPatternsForPrompt(patterns)
    }

    // v1.5 W#10 Push 2(b): also pull semantically similar rejections from
    // OTHER deps (cross-dep failure modes). Best-effort + clearly labeled as a
    // weaker signal so the LLM doesn't over-weight a different package's
    // rejection. Excludes anything already returned by the exact-match pass.
    const query = [
      `dependency: ${dep.name}`,
      primaryChangeType ? `change: ${primaryChangeType}` : '',
      breakingText,
    ].filter(Boolean).join('\n')
    const similar = await recallSimilarRejections(query, { excludeIds: patterns.map((p) => p.id), limit: 3 })
    if (similar.length > 0) {
      emit(`Found ${similar.length} semantically similar rejection(s) from other deps — feeding as weaker signal`)
      priorRejections += '\n\n' + formatSimilarPatternsForPrompt(similar)
    }
  } catch (err) {
    emit(`Rejection recall failed (${String(err).slice(0, 80)}) — continuing without prior context`)
  }

  const prompt = `
You are analyzing a TypeScript project that needs to upgrade the npm package "${dep.name}" from ${dep.currentVersion} to ${dep.latestVersion}.

Breaking changes identified:
${breakingText}

Source files in this project:
${['package.json', ...sourceFiles].join('\n')}${priorRejections}

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
