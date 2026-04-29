import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export interface FsListParams { path: string }
export interface FsListResult { entries: { name: string; type: 'dir' | 'file' }[] }

export interface FsStatParams { path: string }
export interface FsStatResult { exists: boolean; readable: boolean; type: 'dir' | 'file' | null }

function safePath(p: string): string {
  const resolved = path.resolve(p)
  const home = os.homedir()
  const inHome = resolved === home || resolved.startsWith(home + '/')
  const isAncestor = resolved === '/' || home.startsWith(resolved + '/')
  if (!inHome && !isAncestor) {
    throw new Error('Path outside allowed root')
  }
  return resolved
}

export async function fsList(params: FsListParams): Promise<FsListResult> {
  const resolved = safePath(params.path)
  const entries = await readdir(resolved, { withFileTypes: true })
  return {
    entries: entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        type: (e.isDirectory() ? 'dir' : 'file') as 'dir' | 'file',
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
  }
}

export async function fsStat(params: FsStatParams): Promise<FsStatResult> {
  const resolved = safePath(params.path)
  try {
    const s = await stat(resolved)
    return { exists: true, readable: true, type: s.isDirectory() ? 'dir' : 'file' }
  } catch (e: any) {
    if (e.code === 'ENOENT') return { exists: false, readable: false, type: null }
    if (e.code === 'EACCES') return { exists: true, readable: false, type: null }
    throw e
  }
}

export interface FsHomedirResult { path: string }

export async function fsHomedir(): Promise<FsHomedirResult> {
  return { path: os.homedir() }
}
