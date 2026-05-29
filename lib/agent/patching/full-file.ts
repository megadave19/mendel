import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod'
import { llmComplete } from '@/lib/llm'
import type { BreakingChange } from '@/lib/agent/signals/changelog'
import type { Diagnosis } from '@/lib/agent/phases/diagnose'
import type { StaleDep } from '@/lib/agent/phases/detect'

const execAsync = promisify(exec)

// ─── Types ───────────────────────────────────────────────────────────────────

export type FilePatch = {
  filePath: string
  originalContent: string
  patchedContent: string
  explanation: string
}

const PatchedFileSchema = z.object({
  content: z.string().min(1),
  explanation: z.string().max(300),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function runPrettier(filePath: string): Promise<void> {
  try {
    await execAsync(`npx prettier --write "${filePath}"`, { timeout: 30_000 })
  } catch {
    // non-fatal — prettier may not be configured in target repo
  }
}

function bumpPackageJson(
  fullPath: string,
  originalContent: string,
  dep: StaleDep,
): FilePatch {
  // Surgical, formatting-preserving version bump. We deliberately do NOT
  // JSON.parse + JSON.stringify: that re-serializes the WHOLE file at a fixed
  // 2-space indent, so a repo using tabs (e.g. execa) gets every line rewritten
  // — turning a 1-line change into a whole-file diff that fails the repo's lint
  // and reads as AI slop. Instead we replace only this dep's version value(s)
  // in the raw text, preserving indentation, key order, AND the original range
  // operator (^, ~, >=, … — the old code hardcoded ^, silently changing pinned
  // deps). Exact-key match so "is-in-ci" never matches "is-in-ci-extra".
  const escaped = dep.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const entry = new RegExp(`("${escaped}"\\s*:\\s*")([^"]+)(")`, 'g')
  let replaced = 0
  const patched = originalContent.replace(entry, (_m, pre: string, spec: string, post: string) => {
    replaced++
    const prefix = (spec.match(/^[\^~>=<\s]*/) ?? [''])[0] // keep the original range operator
    return `${pre}${prefix}${dep.latestVersion}${post}`
  })

  if (replaced === 0) {
    // Dep wasn't found in package.json text (shouldn't happen — it was detected
    // from here). Leave the file untouched and report honestly (§5b).
    return {
      filePath: 'package.json',
      originalContent,
      patchedContent: originalContent,
      explanation: `No version entry found for ${dep.name} in package.json — left unchanged`,
    }
  }

  writeFileSync(fullPath, patched, 'utf-8')
  return {
    filePath: 'package.json',
    originalContent,
    patchedContent: patched,
    explanation: `Bumped ${dep.name} ${dep.currentVersion} → ${dep.latestVersion} (version-only; formatting preserved)`,
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function patchFile(
  repoPath: string,
  relativeFilePath: string,
  dep: StaleDep,
  breakingChanges: BreakingChange[],
  diagnosis: Diagnosis,
  emit: (msg: string) => void,
): Promise<FilePatch | null> {
  const fullPath = path.join(repoPath, relativeFilePath)

  if (!existsSync(fullPath)) {
    emit(`  skip ${relativeFilePath} — not found`)
    return null
  }

  const originalContent = readFileSync(fullPath, 'utf-8')
  emit(`Patching ${relativeFilePath}...`)

  // package.json: deterministic version bump, no LLM needed
  if (relativeFilePath === 'package.json') {
    return bumpPackageJson(fullPath, originalContent, dep)
  }

  const breakingText = breakingChanges
    .map((bc) => `- ${bc.symbol} (${bc.changeType}): ${bc.description}`)
    .join('\n')

  const prompt = `
You are fixing a TypeScript source file that uses the npm package "${dep.name}".
The package is being upgraded from ${dep.currentVersion} to ${dep.latestVersion}.

Breaking changes requiring code changes:
${breakingText || 'Major version bump — update API usage per migration guide.'}

Patch strategy: ${diagnosis.patchStrategy}

Current file (${relativeFilePath}):
\`\`\`typescript
${originalContent.slice(0, 8000)}
\`\`\`

Return the COMPLETE updated file as JSON. Do not truncate — return the full file content:
{
  "content": "complete updated TypeScript file content",
  "explanation": "what you changed and why (max 300 chars)"
}

Rules:
- Return the full file, not just changed parts
- Only change what the upgrade requires
- Maintain code style and formatting
- Do not add comments about the changes
`

  try {
    const result = await llmComplete(prompt, PatchedFileSchema, { maxTokens: 8192 })
    writeFileSync(fullPath, result.content, 'utf-8')
    await runPrettier(fullPath)
    const finalContent = readFileSync(fullPath, 'utf-8')

    return {
      filePath: relativeFilePath,
      originalContent,
      patchedContent: finalContent,
      explanation: result.explanation,
    }
  } catch (err) {
    emit(`  ✗ patch failed for ${relativeFilePath}: ${String(err)}`)
    return null
  }
}
