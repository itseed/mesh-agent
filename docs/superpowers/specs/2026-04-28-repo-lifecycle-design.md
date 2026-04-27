# Design: Repo Lifecycle — Lazy Clone + Worktree

**Date:** 2026-04-28  
**Status:** Approved

## Problem

ปัจจุบัน MeshAgent ไม่มี mechanism จัดการ repo บน server:
- User ต้อง clone เองและระบุ path ใน project settings
- ไม่มีการสร้าง/ลบ worktree อัตโนมัติ → agents อาจชนกันใน directory เดียวกัน
- ไม่มี cleanup เมื่อลบ project

## Goal

ระบบจัดการ git repo lifecycle ทั้งหมดอัตโนมัติ:
- Lazy clone ครั้งแรกที่ dispatch task
- สร้าง worktree แยกต่อ task เพื่อ concurrent safety
- ลบ worktree เมื่อ task เสร็จ
- ลบ base clone เมื่อลบ project

## Flow

```
User dispatch task
        ↓
API → POST /sessions { workingDir, repoUrl, taskId, ... }
        ↓
Orchestrator (git.ts):
  ┌─ dir ไม่มี? → git clone --depth 50 {repoUrl} {workingDir}
  └─ dir มีแล้ว → git -C {workingDir} pull --ff-only
        ↓
  git -C {workingDir} worktree add worktrees/{taskId} -b task/{taskId}
        ↓
Agent รันใน {workingDir}/worktrees/{taskId}/
        ↓
Task complete (internal callback)
        ↓
git -C {workingDir} worktree remove worktrees/{taskId} --force
git -C {workingDir} branch -D task/{taskId}
```

## Directory Structure

```
{reposBaseDir}/
  {project-id}/
    {repo-name}/                    ← base clone (ถาวรตลอดชีวิต project)
      .git/                         ← shared object store
      worktrees/
        {task-id}/                  ← agent worktree (ephemeral)
        {task-id-2}/                ← concurrent tasks ได้ ไม่ชนกัน
    {repo-name-2}/
      .git/
      worktrees/
        ...
```

## API Changes

### `POST /sessions` (Orchestrator)

เพิ่ม optional fields:
```json
{
  "role": "frontend",
  "workingDir": "/repos/proj-123/my-frontend",
  "repoUrl": "https://github.com/owner/repo",
  "taskId": "task-abc",
  "prompt": "..."
}
```

- ถ้า `repoUrl` มี → orchestrator จัดการ clone/pull + worktree ก่อน start agent
- `workingDir` = base clone path (ไม่ใช่ worktree path)
- Agent จะรันใน `{workingDir}/worktrees/{taskId}/` จริงๆ

### `POST /internal/agent-complete` (API)

เพิ่ม trigger cleanup worktree:
- หลัง update task stage → call `DELETE /sessions/{sessionId}/worktree` หรือ orchestrator cleanup worktree เองใน session lifecycle

### `DELETE /projects/:id` (API)

หลังลบ project จาก DB → ลบ `{reposBaseDir}/{project-id}/` directory ทั้งหมด

## New File: `orchestrator/src/git.ts`

```ts
export async function ensureRepo(workingDir: string, repoUrl: string): Promise<void>
// clone ถ้าไม่มี, pull ถ้ามีแล้ว

export async function createWorktree(workingDir: string, taskId: string): Promise<string>
// return path ของ worktree = {workingDir}/worktrees/{taskId}

export async function removeWorktree(workingDir: string, taskId: string): Promise<void>
// git worktree remove + branch delete

export async function removeProjectDir(reposBaseDir: string, projectId: string): Promise<void>
// rm -rf {reposBaseDir}/{projectId}
```

## Orphan Cleanup

worktree ที่ task crash โดยไม่ได้ cleanup → orphan

**Detection:** query DB หา tasks ที่ stage = 'done' | 'failed' แต่ยังมี worktree directory อยู่

**Cleanup:** orchestrator startup + periodic check ทุก 1 ชั่วโมง
- `git worktree list --porcelain` เพื่อ list ทุก worktree
- เปรียบเทียบกับ active task IDs จาก DB
- ลบ orphan worktrees

## Disk Management

| Strategy | Detail |
|---|---|
| Shallow clone | `git clone --depth 50` ลด initial size |
| Worktree sharing | share `.git/` objects → worktree ใช้ disk แค่ working tree |
| Auto cleanup | ลบ worktree ทันทีเมื่อ task เสร็จ |
| Project cleanup | ลบทั้ง project dir เมื่อลบ project |
| Orphan cron | ตรวจ orphan worktrees ทุก 1 ชั่วโมง |

## Disk Usage Display (UI)

- หน้า Projects แสดง disk usage ต่อ project: `du -sh {reposBaseDir}/{project-id}/`
- API endpoint `GET /projects/:id/disk-usage` → `{ bytes: number, human: "1.2 GB" }`

## Error Handling

| Scenario | Behavior |
|---|---|
| Clone fail (no auth, wrong URL) | session fail ทันที, error message ใน chat |
| Pull fail (conflicts) | ใช้ existing clone ต่อ, log warning |
| Worktree creation fail | session fail, cleanup branch |
| Disk full | clone/worktree fail → error ชัดเจน "Disk full on server" |
| repoUrl ไม่ได้ส่งมา | ข้าม git step, ใช้ workingDir ตรงๆ (backward compat) |

## Out of Scope

- GitHub webhook auto-pull (v2)
- Disk usage alerts / threshold monitoring (v2)
- `git gc` scheduling (v2)
- Private repo auth beyond GITHUB_TOKEN (v2)
