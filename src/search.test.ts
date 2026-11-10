import { describe, it, expect } from 'vitest'
import { findMatches } from './search'

describe('findMatches', () => {
  it('returns empty for empty query or no matches', () => {
    expect(findMatches('hello world', '')).toEqual([])
    expect(findMatches('hello world', 'xyz')).toEqual([])
  })

  it('matches case-insensitively', () => {
    expect(findMatches('Hello hello HELLO', 'hello')).toEqual([0, 6, 12])
  })

  it('finds non-overlapping matches only (DOM marks cannot overlap)', () => {
    expect(findMatches('ababab', 'abab')).toEqual([0])
    expect(findMatches('aaa', 'aa')).toEqual([0])
  })

  it('handles multi-character queries and unicode text', () => {
    expect(findMatches('héllo héllo', 'héllo')).toEqual([0, 6])
  })
})
