'use client'

import { useEffect, useRef, useState } from 'react'
import type { AgentEvent } from '@/lib/agent/runner'

export interface StreamEntry {
  id: string
  timestamp: number
  event: AgentEvent
}

export interface StreamState {
  entries: StreamEntry[]
  connected: boolean
  done: boolean
  error: string | null
}

export function useScanStream(scanId: string): StreamState {
  const [entries, setEntries] = useState<StreamEntry[]>([])
  const [connected, setConnected] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const counterRef = useRef(0)

  useEffect(() => {
    if (!scanId) return

    const es = new EventSource(`/api/scans/${scanId}/stream`)
    esRef.current = es

    es.onopen = () => setConnected(true)

    es.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data as string) as AgentEvent
        const entry: StreamEntry = {
          id: `${Date.now()}-${counterRef.current++}`,
          timestamp: Date.now(),
          event,
        }
        setEntries((prev) => [...prev, entry])
        if (event.type === 'done' || event.type === 'error') {
          setDone(true)
          es.close()
        }
      } catch {
        // ignore malformed events
      }
    }

    es.onerror = () => {
      setConnected(false)
      if (!done) setError('Stream disconnected')
      es.close()
    }

    return () => {
      es.close()
    }
  }, [scanId, done])

  return { entries, connected, done, error }
}
