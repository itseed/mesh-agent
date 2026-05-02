import { env } from '../env.js';
import { companionManager } from './companionManager.js';
import { agentSessions } from '@meshagent/shared';
import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';

export async function dispatchAgent(
  role: string,
  workingDir: string,
  prompt: string,
  context: {
    projectId?: string | null;
    taskId?: string | null;
    createdBy?: string | null;
    cliProvider?: string;
    executionMode?: 'cloud' | 'local';
    userId?: string;
    db?: ReturnType<typeof drizzle>;
  },
  systemPrompt?: string,
  repoUrl?: string,
): Promise<{ id: string | null; error?: string }> {
  const { executionMode = 'cloud', userId, db } = context;

  if (executionMode === 'local') {
    if (!userId) return { id: null, error: 'userId required for local execution' };
    const sessionId = `local-${crypto.randomUUID()}`;

    if (db) {
      await db.insert(agentSessions).values({
        id: sessionId,
        role,
        workingDir,
        prompt,
        status: 'running',
        projectId: context.projectId ?? null,
        taskId: context.taskId ?? null,
        cliProvider: context.cliProvider ?? null,
        executionMode: 'local',
        createdBy: context.createdBy ?? null,
        startedAt: new Date(),
      });
    }

    try {
      await companionManager.call(userId, 'agent.spawn', {
        sessionId,
        role,
        workingDir,
        prompt,
        cliProvider: context.cliProvider ?? 'claude',
        taskId: context.taskId ?? undefined,
        projectId: context.projectId ?? undefined,
        apiUrl: process.env.COMPANION_CALLBACK_URL ?? 'http://localhost:4801',
        internalSecret: env.INTERNAL_SECRET,
      });
      return { id: sessionId };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (db) {
        await db
          .update(agentSessions)
          .set({ status: 'errored', error: msg, endedAt: new Date() })
          .where(eq(agentSessions.id, sessionId));
      }
      return { id: null, error: msg || 'Companion dispatch failed' };
    }
  }

  // Cloud path — dispatch to orchestrator
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${env.ORCHESTRATOR_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': env.INTERNAL_SECRET },
      body: JSON.stringify({
        role,
        workingDir,
        prompt,
        projectId: context.projectId,
        taskId: context.taskId,
        createdBy: context.createdBy,
        cliProvider: context.cliProvider,
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(repoUrl ? { repoUrl } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return { id: null, error: err.error ?? `Orchestrator returned ${res.status}` };
    }
    const data = (await res.json()) as { id?: string };
    return { id: data.id ?? null };
  } catch (e: unknown) {
    return { id: null, error: e instanceof Error ? e.message : 'Orchestrator request failed' };
  } finally {
    clearTimeout(timer);
  }
}

export function buildGitInstructions(baseBranch: string, branchSuffix: string, inWorktree = false): string {
  const beforeWork = inWorktree
    ? `\`\`\`bash\ngit checkout -b task/\${ROLE}-${branchSuffix}\n\`\`\``
    : `\`\`\`bash\ngit fetch origin\ngit checkout ${baseBranch}\ngit pull origin ${baseBranch}\ngit checkout -b task/\${ROLE}-${branchSuffix}\n\`\`\``;

  return `

## Git Workflow (REQUIRED — ทำทุกครั้ง)
Base branch: \`${baseBranch}\`

**ก่อนเริ่มงาน:**
${beforeWork}
(แทน \${ROLE} ด้วย role ของตัวเอง เช่น frontend, backend)

**ระหว่างทำงาน:** commit บ่อยๆ

**เมื่องานเสร็จ:**
\`\`\`bash
git push -u origin HEAD
gh pr create --base ${baseBranch} --title "<สรุปงานที่ทำ>" --body "<รายละเอียด>"
\`\`\`

**สำคัญ:** แจ้ง PR URL กลับมาในรายงานสุดท้ายด้วย

## สรุปงาน (REQUIRED — ต้องทำสุดท้ายก่อนจบ)
พิมพ์สรุปในรูปแบบนี้ก่อนสิ้นสุดการทำงาน:

TASK_COMPLETE
summary: <สรุปสิ่งที่ทำไปใน 1-2 ประโยค ภาษาไทยหรืออังกฤษก็ได้>
pr_url: <URL ของ PR ที่เปิด หรือ none>
END_TASK_COMPLETE`;
}
