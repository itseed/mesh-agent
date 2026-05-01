import { describe, it, expect } from 'vitest'
import {
  parseReviewIssues,
  filterNoise,
} from '@/components/kanban/task-detail/utils'

describe('parseReviewIssues', () => {
  it('returns empty array for empty body', () => {
    expect(parseReviewIssues('')).toEqual([])
  })

  it('returns empty array when no recognizable patterns', () => {
    expect(parseReviewIssues('just some random comment')).toEqual([])
  })

  it('parses Thai summary line with critical issues', () => {
    const body = '**สรุป:** CRITICAL 2 จุด (SQL injection, XSS in form)'
    expect(parseReviewIssues(body)).toEqual([
      { title: 'SQL injection', severity: 'critical' },
      { title: 'XSS in form', severity: 'critical' },
    ])
  })

  it('parses Thai summary with all four severities', () => {
    const body =
      '**สรุป:** CRITICAL 1 จุด (auth bypass) HIGH 1 จุด (race condition) MEDIUM 1 จุด (slow query) LOW 1 จุด (typo)'
    const issues = parseReviewIssues(body)
    expect(issues).toEqual([
      { title: 'auth bypass', severity: 'critical' },
      { title: 'race condition', severity: 'high' },
      { title: 'slow query', severity: 'medium' },
      { title: 'typo', severity: 'low' },
    ])
  })

  it('trims whitespace around comma-separated titles', () => {
    const body = '**สรุป:** HIGH 3 จุด (  one  ,two,   three  )'
    expect(parseReviewIssues(body)).toEqual([
      { title: 'one', severity: 'high' },
      { title: 'two', severity: 'high' },
      { title: 'three', severity: 'high' },
    ])
  })

  it('drops empty entries from comma-separated lists', () => {
    const body = '**สรุป:** MEDIUM 2 จุด (only-one,,)'
    expect(parseReviewIssues(body)).toEqual([
      { title: 'only-one', severity: 'medium' },
    ])
  })

  it('parses English summary marker as fallback when Thai missing', () => {
    const body = 'summary: CRITICAL 1 จุด (broken auth)'
    expect(parseReviewIssues(body)).toEqual([
      { title: 'broken auth', severity: 'critical' },
    ])
  })

  it('falls back to numbered bold items when no summary line', () => {
    const body =
      'Some intro\n**1. fix login bug**\n**2. `reduce timeout`**\nmore text'
    expect(parseReviewIssues(body)).toEqual([
      { title: 'fix login bug', severity: 'medium' },
      { title: 'reduce timeout', severity: 'medium' },
    ])
  })

  it('does not use the fallback when summary line already produced issues', () => {
    const body =
      '**สรุป:** HIGH 1 จุด (real issue)\n**1. should not be picked**'
    expect(parseReviewIssues(body)).toEqual([
      { title: 'real issue', severity: 'high' },
    ])
  })

  it('ignores numbered items whose trimmed title is too short', () => {
    // Single-char titles (e.g. **1. a**) are dropped because the regex
    // requires at least 3 chars in the char class (which includes the
    // leading space that \s* leaves behind after backtracking).
    const body = '**1. a**\n**2. valid title here**'
    expect(parseReviewIssues(body)).toEqual([
      { title: 'valid title here', severity: 'medium' },
    ])
  })

  it('caps fallback title length at 80 chars (longer items skipped)', () => {
    const longTitle = 'x'.repeat(81)
    const body = `**1. ${longTitle}**\n**2. short ok**`
    expect(parseReviewIssues(body)).toEqual([
      { title: 'short ok', severity: 'medium' },
    ])
  })
})

describe('filterNoise', () => {
  it('returns empty string for empty input', () => {
    expect(filterNoise('')).toBe('')
  })

  it('drops [warn] workingDir lines', () => {
    const input = 'good line\n[warn] workingDir missing\nanother good line'
    expect(filterNoise(input)).toBe('good line\nanother good line')
  })

  it('drops SessionEnd hook lines', () => {
    expect(filterNoise('keep\nSessionEnd hook fired\nkeep2')).toBe('keep\nkeep2')
  })

  it('drops Cannot find module lines', () => {
    expect(filterNoise('a\nError: Cannot find module foo\nb')).toBe('a\nb')
  })

  it('drops requireStack lines', () => {
    expect(filterNoise('a\n  at requireStack: [foo]\nb')).toBe('a\nb')
  })

  it('strips leading/trailing whitespace from result', () => {
    expect(filterNoise('\n\n  hello  \n\n')).toBe('hello')
  })

  it('returns empty string when every line is noise', () => {
    const input = '[warn] workingDir x\nSessionEnd hook done'
    expect(filterNoise(input)).toBe('')
  })
})
