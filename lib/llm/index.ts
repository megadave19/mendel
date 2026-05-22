import { GoogleGenerativeAI } from '@google/generative-ai'
import { z } from 'zod'

const MODEL = 'gemini-2.5-flash'
const SYSTEM_INSTRUCTION =
  'You are a precise JSON API. Return only valid JSON matching the requested schema. No markdown fences, no explanation, no prose — raw JSON only.'

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
}

// Cap on transient (503 / per-minute-429) retries. Far lower than before — a
// rate-limit error that doesn't clear in a couple of short waits won't clear by
// hammering it, so we stop rather than burn more quota.
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
  // Daily free-tier exhaustion: RESOURCE_EXHAUSTED on a per-day metric.
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

export async function llmComplete<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  opts?: { maxTokens?: number; retries?: number },
): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: { maxOutputTokens: opts?.maxTokens ?? 8192 },
  })

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
      const result = await model.generateContent(prompt + retryNote)
      const raw = stripFences(result.response.text())
      return schema.parse(JSON.parse(raw))
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const cls = classifyError(lastError.message)

      if (cls === 'daily-quota') {
        // Fail fast — no point looping for minutes on an hours-long reset.
        throw new Error(
          'Gemini daily free-tier quota exhausted. Wait for the daily reset, enable billing on the API key, or switch the LLM provider. ' +
            `(${lastError.message})`,
        )
      }

      if (cls === 'transient') {
        if (transientRetries >= MAX_TRANSIENT_RETRIES) {
          throw new Error(
            `LLM rate-limited / unavailable after ${MAX_TRANSIENT_RETRIES} retries. ${lastError.message}`,
          )
        }
        // Honor a short server-provided hint, else exponential backoff, both capped.
        const hint = lastError.message.match(/retry in (\d+(?:\.\d+)?)s/)
        const backoff = hint
          ? Math.ceil(parseFloat(hint[1]) * 1000) + 1000
          : Math.min(5_000 * 2 ** transientRetries, MAX_TRANSIENT_WAIT_MS)
        const waitMs = Math.min(backoff, MAX_TRANSIENT_WAIT_MS)
        transientRetries++
        console.log(`[llm] Transient error (${transientRetries}/${MAX_TRANSIENT_RETRIES}) — waiting ${Math.round(waitMs / 1000)}s...`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue // don't count against schema retries
      }

      if (cls === 'schema') {
        schemaAttempt++ // retry with corrective feedback
        continue
      }

      // fatal — auth, malformed request, etc.
      throw new Error(`LLM call failed: ${lastError.message}`)
    }
  }

  throw new Error(`LLM failed schema validation after ${maxSchemaRetries} attempts: ${lastError.message}`)
}
