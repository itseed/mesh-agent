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
  cliProvider?: string
  taskId?: string
  projectId?: string
  apiUrl?: string
  internalSecret?: string
}): Promise<{ sessionId: string }> {
  const { sessionId, role, workingDir, prompt, cliProvider, taskId, projectId, apiUrl, internalSecret } = params

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

  proc.on('exit', async (exitCode) => {
    const e = agents.get(sessionId)
    agents.delete(sessionId)

    if (apiUrl && internalSecret && e) {
      const outputLog = e.stdout.slice(-10000)
      try {
        await fetch(`${apiUrl}/internal/agent-complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': internalSecret,
          },
          body: JSON.stringify({
            sessionId,
            taskId: taskId ?? null,
            role,
            success: exitCode === 0,
            outputLog,
            projectId: projectId ?? null,
            exitCode: exitCode ?? null,
          }),
        })
      } catch {
        // best-effort — ignore network errors
      }
    }
  })

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
