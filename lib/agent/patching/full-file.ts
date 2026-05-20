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
  const pkg = JSON.parse(originalContent) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  if (pkg.dependencies?.[dep.name]) {
    pkg.dependencies[dep.name] = `^${dep.latestVersion}`
  }
  if (pkg.devDependencies?.[dep.name]) {
    pkg.devDependencies[dep.name] = `^${dep.latestVersion}`
  }

  const patched = JSON.stringify(pkg, null, 2) + '\n'
  writeFileSync(fullPath, patched, 'utf-8')

  return {
    filePath: 'package.json',
    originalContent,
    patchedContent: patched,
    explanation: `Bumped ${dep.name} from ${dep.currentVersion} to ^${dep.latestVersion}`,
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
