import { spawn, ChildProcess } from 'node:child_process'

interface SpawnedAgent {
  process: ChildProcess
  stdout: string
  role: string
  startedAt: Date
}

const agents = new Map<string, SpawnedAgent>()

export async function agentSpawn(params: {
  sessionId: string
  role: string
  workingDir: string
  prompt: string
  cliProvider: string
}): Promise<{ sessionId: string }> {
  const { sessionId, role, workingDir, prompt, cliProvider } = params

  const cmd = cliProvider === 'gemini' ? 'gemini' : 'claude'
  const args = ['--dangerously-skip-permissions', '--print', prompt]

  const proc = spawn(cmd, args, {
    cwd: workingDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const entry: SpawnedAgent = { process: proc, stdout: '', role, startedAt: new Date() }
  agents.set(sessionId, entry)

  proc.stdout.on('data', (chunk: Buffer) => {
    const e = agents.get(sessionId)
    if (e) e.stdout += chunk.toString()
  })
  proc.stderr.on('data', (chunk: Buffer) => {
    const e = agents.get(sessionId)
    if (e) e.stdout += chunk.toString()
  })
  proc.on('exit', () => agents.delete(sessionId))

  return { sessionId }
}

export async function agentStdout(params: {
  sessionId: string
}): Promise<{ output: string; running: boolean }> {
  const entry = agents.get(params.sessionId)
  if (!entry) return { output: '', running: false }
  return { output: entry.stdout, running: true }
}

export async function agentKill(params: {
  sessionId: string
}): Promise<{ ok: boolean }> {
  const entry = agents.get(params.sessionId)
  if (!entry) return { ok: false }
  entry.process.kill('SIGTERM')
  agents.delete(params.sessionId)
  return { ok: true }
}
