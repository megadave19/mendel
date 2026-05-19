import { describe, it, expect } from 'vitest'
import { add, multiply } from '../src/index'

describe('math', () => {
  it('adds', () => expect(add(1, 2)).toBe(3))
  it('multiplies', () => expect(multiply(3, 4)).toBe(12))
})
