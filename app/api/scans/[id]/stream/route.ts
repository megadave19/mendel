import { NextRequest, NextResponse } from 'next/server'
import { getScanEmitter, type AgentEvent } from '@/lib/agent/runner'
import { applyRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function formatSSE(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

function heartbeat(): string {
  return `: heartbeat\n\n`
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Rate limit SSE connections — same general cap (60/min)
  const limited = applyRateLimit(_req, 'api')
  if (limited) return limited as NextResponse

  const { id } = await params

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const send = (text: string) => controller.enqueue(encoder.encode(text))

      // Send initial heartbeat so client knows connection is live
      send(heartbeat())

      const emitter = getScanEmitter(id)

      if (!emitter) {
        // Scan already done or doesn't exist — send a synthetic done event
        send(formatSSE({ type: 'done', summary: 'Scan not active.' }))
        controller.close()
        return
      }

      const onEvent = (event: AgentEvent) => {
        try {
          send(formatSSE(event))
          if (event.type === 'done' || event.type === 'error') {
            clearInterval(hbInterval)
            controller.close()
          }
        } catch {
          // controller already closed
        }
      }

      emitter.on('event', onEvent)

      // Heartbeat every 15s to keep connection alive through proxies
      const hbInterval = setInterval(() => {
        try {
          send(heartbeat())
        } catch {
          clearInterval(hbInterval)
        }
      }, 15_000)

      // Clean up if client disconnects
      _req.signal.addEventListener('abort', () => {
        emitter.off('event', onEvent)
        clearInterval(hbInterval)
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  })
}
