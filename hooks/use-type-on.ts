'use client'

/**
 * useTypeOn — reveals text one character at a time (DESIGN.md §7 type-on beat).
 * Boot hero uses 35ms/char; running-mode log lines use 22ms/char.
 *
 * Respects prefers-reduced-motion: returns the full string immediately.
 */

import { useEffect, useState } from 'react'

export function useTypeOn(text: string, msPerChar = 35, startDelay = 0): { shown: string; done: boolean } {
  const [count, setCount] = useState(0)

  useEffect(() => {
    setCount(0)

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (reduced) {
      setCount(text.length)
      return
    }

    let interval: ReturnType<typeof setInterval> | null = null
    const startTimer = setTimeout(() => {
      interval = setInterval(() => {
        setCount((c) => {
          if (c >= text.length) {
            if (interval) clearInterval(interval)
            return c
          }
          return c + 1
        })
      }, msPerChar)
    }, startDelay)

    return () => {
      clearTimeout(startTimer)
      if (interval) clearInterval(interval)
    }
  }, [text, msPerChar, startDelay])

  return { shown: text.slice(0, count), done: count >= text.length }
}
