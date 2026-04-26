import { env } from '../env.js'

export async function dispatchAgent(
  role: string,
  workingDir: string,
  prompt: string,
  context: { projectId?: string | null; taskId?: string | null; createdBy?: string | null },
): Promise<{ id: string | null; error?: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res = await fetch(`${env.ORCHESTRATOR_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, workingDir, prompt, ...context }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      return { id: null, error: err.error ?? `Orchestrator returned ${res.status}` }
    }
    const data = (await res.json()) as { id?: string }
    return { id: data.id ?? null }
  } catch (e: any) {
    return { id: null, error: e?.message ?? 'Orchestrator request failed' }
  } finally {
    clearTimeout(timer)
  }
}

export function buildGitInstructions(baseBranch: string, branchSuffix: string): string {
  return `

## Git Workflow (REQUIRED — ทำทุกครั้ง)
Base branch: \`${baseBranch}\`

**ก่อนเริ่มงาน:**
\`\`\`bash
git fetch origin
git checkout ${baseBranch}
git pull origin ${baseBranch}
git checkout -b task/\${ROLE}-${branchSuffix}
\`\`\`
(แทน \${ROLE} ด้วย role ของตัวเอง เช่น frontend, backend)

**ระหว่างทำงาน:** commit บ่อยๆ

**เมื่องานเสร็จ:**
\`\`\`bash
git push -u origin HEAD
gh pr create --base ${baseBranch} --title "<สรุปงานที่ทำ>" --body "<รายละเอียด>"
\`\`\`

**สำคัญ:** แจ้ง PR URL กลับมาในรายงานสุดท้ายด้วย`
}
