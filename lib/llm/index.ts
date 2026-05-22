import { GoogleGenerativeAI } from '@google/generative-ai'
import { z } from 'zod'

/**
 * Provider-agnostic LLM client.
 *
 * The agent calls llmComplete() — it never knows which model answered. Provider
 * is chosen by env (LLM_PROVIDER), default 'gemini' so existing behavior/quality
 * is unchanged. 'github-models' uses GitHub's free OpenAI-compatible endpoint as
 * a no-cost fallback. The retry/classify/schema-validation loop is shared across
 * providers; only the raw call differs.
 */

const GEMINI_MODEL = 'gemini-2.5-flash'
const SYSTEM_INSTRUCTION =
  'You are a precise JSON API. Return only valid JSON matching the requested schema. No markdown fences, no explanation, no prose — raw JSON only.'

type Provider = 'gemini' | 'github-models'

export function getProvider(): Provider {
  return process.env.LLM_PROVIDER === 'github-models' ? 'github-models' : 'gemini'
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
}

// ── Error classification (shared) ─────────────────────────────────────────────

const MAX_TRANSIENT_RETRIES = 3
const MAX_TRANSIENT_WAIT_MS = 60_000

type ErrorClass = 'daily-quota' | 'transient' | 'schema' | 'fatal'

/**
 * Classify a provider error so we retry only what can actually recover:
 *  - daily-quota → fail FAST (won't reset for hours; retrying wastes more quota)
 *  - transient   → 503 / per-minute 429 / network — short bounded backoff
 *  - schema      → bad JSON / failed validation — retry with corrective feedback
 *  - fatal       → anything else (auth, bad request) — give up
 */
export function classifyError(msg: string): ErrorClass {
  const m = msg.toLowerCase()
  if (/per ?day|requestsperday|free_tier.*day|quota.*exceeded|resource_exhausted/.test(m) && !/retry in \d/.test(m)) {
    return 'daily-quota'
  }
  if (m.includes('429') || m.includes('rate limit') || m.includes('quota')) return 'transient'
  if (m.includes('503') || m.includes('high demand') || m.includes('overload') || m.includes('fetch') || m.includes('network')) {
    return 'transient'
  }
  if (m.includes('json') || m.includes('schema') || m.includes('parse') || /expected .+received/.test(m)) return 'schema'
  return 'fatal'
}

// ── Provider calls (return raw text) ──────────────────────────────────────────

async function callGemini(prompt: string, maxTokens: number): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL ?? GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
  })
  const result = await model.generateContent(prompt)
  return result.response.text()
}

async function callGitHubModels(prompt: string, maxTokens: number): Promise<string> {
  const token = process.env.GITHUB_MODELS_TOKEN
  if (!token) throw new Error('GITHUB_MODELS_TOKEN is not set')

  const baseUrl = process.env.GITHUB_MODELS_BASE_URL ?? 'https://models.github.ai/inference'
  const model = process.env.GITHUB_MODELS_MODEL ?? 'gpt-4o-mini'

  // OpenAI-compatible chat-completions call via fetch (no SDK dependency).
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  })

  if (!res.ok) {
    // Include the HTTP status so classifyError can route 429/503 correctly.
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${body.slice(0, 300)}`)
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('GitHub Models: empty response')
  return content
}

async function callProvider(prompt: string, maxTokens: number): Promise<string> {
  return getProvider() === 'github-models'
    ? callGitHubModels(prompt, maxTokens)
    : callGemini(prompt, maxTokens)
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function llmComplete<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  opts?: { maxTokens?: number; retries?: number },
): Promise<T> {
  const maxTokens = opts?.maxTokens ?? 8192
  const maxSchemaRetries = opts?.retries ?? 3

  let schemaAttempt = 0
  let transientRetries = 0
  let lastError: Error = new Error('Unknown error')

  while (schemaAttempt < maxSchemaRetries) {
    const retryNote =
      schemaAttempt > 0
        ? `\n\nIMPORTANT: Your previous response failed JSON schema validation with: ${lastError.message}. Return valid JSON only.`
        : ''

    try {
      const raw = stripFences(await callProvider(prompt + retryNote, maxTokens))
      return schema.parse(JSON.parse(raw))
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const cls = classifyError(lastError.message)

      if (cls === 'daily-quota') {
        throw new Error(
          'LLM daily free-tier quota exhausted. Wait for the daily reset, enable billing, or switch LLM_PROVIDER (gemini ↔ github-models). ' +
            `(${lastError.message})`,
        )
      }

      if (cls === 'transient') {
        if (transientRetries >= MAX_TRANSIENT_RETRIES) {
          throw new Error(`LLM rate-limited / unavailable after ${MAX_TRANSIENT_RETRIES} retries. ${lastError.message}`)
        }
        const hint = lastError.message.match(/retry in (\d+(?:\.\d+)?)s/)
        const backoff = hint
          ? Math.ceil(parseFloat(hint[1]) * 1000) + 1000
          : Math.min(5_000 * 2 ** transientRetries, MAX_TRANSIENT_WAIT_MS)
        const waitMs = Math.min(backoff, MAX_TRANSIENT_WAIT_MS)
        transientRetries++
        console.log(`[llm] Transient error (${transientRetries}/${MAX_TRANSIENT_RETRIES}) — waiting ${Math.round(waitMs / 1000)}s...`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }

      if (cls === 'schema') {
        schemaAttempt++
        continue
      }

      throw new Error(`LLM call failed: ${lastError.message}`)
    }
  }

  throw new Error(`LLM failed schema validation after ${maxSchemaRetries} attempts: ${lastError.message}`)
}
