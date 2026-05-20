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

  const maxRetries = opts?.retries ?? 3
  let lastError: Error = new Error('Unknown error')

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const retryNote =
      attempt > 0
        ? `\n\nIMPORTANT: Your previous response failed JSON schema validation with: ${lastError.message}. Return valid JSON only.`
        : ''

    try {
      const result = await model.generateContent(prompt + retryNote)
      const raw = stripFences(result.response.text())
      const parsed = schema.parse(JSON.parse(raw))
      return parsed
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const msg = lastError.message

      // Rate limit (429) or overload (503): wait then retry without burning a schema-retry attempt
      if (msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('503') || msg.includes('high demand')) {
        const match = msg.match(/retry in (\d+(?:\.\d+)?)s/)
        const waitMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 2000 : 15_000
        console.log(`[llm] Transient error — waiting ${Math.round(waitMs / 1000)}s before retry...`)
        await new Promise((r) => setTimeout(r, waitMs))
        attempt-- // don't count transient errors against schema retries
        if (attempt < -8) break // safety: max 8 transient retries
        continue
      }
    }
  }

  throw new Error(`LLM failed after ${maxRetries} attempts: ${lastError.message}`)
}
