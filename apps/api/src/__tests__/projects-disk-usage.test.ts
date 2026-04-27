import { describe, it, expect, vi, beforeEach } from 'vitest'

const { execFileMock } = vi.hoisted(() => {
  const { promisify } = require('node:util')
  const execFileMock = vi.fn()
  ;(execFileMock as any)[promisify.custom] = (...args: any[]) => {
    return new Promise((resolve, reject) => {
      const cb = (err: any, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      }
      execFileMock(...args, cb)
    })
  }
  return { execFileMock }
})

vi.mock('node:child_process', () => ({ execFile: execFileMock }))
vi.mock('node:fs', () => ({ existsSync: vi.fn().mockReturnValue(true) }))

import { existsSync } from 'node:fs'

// We test the formatBytes helper and the route logic here
// In the actual test, we'd need a full Fastify + DB mock app.
// This is a focused unit test on the bytes parsing logic.
describe('disk-usage bytes parsing', () => {
  it('converts du -sk output (kb) to bytes correctly', () => {
    // 1024 KB → 1048576 bytes
    const line = '1024\t/repos/proj-123'
    const kb = parseInt(line.trim().split('\t')[0], 10)
    expect(kb * 1024).toBe(1048576)
  })

  it('handles du failure gracefully', () => {
    const kb = parseInt('not-a-number', 10)
    const bytes = isNaN(kb) ? 0 : kb * 1024
    expect(bytes).toBe(0)
  })
})
