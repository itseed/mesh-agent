const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export class ApiError extends Error {
  readonly status: number
  readonly body: any
  constructor(message: string, status: number, body: any) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(body?.error ?? 'Request failed', res.status, body)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  auth: {
    login: (email: string, password: string, remember = false) =>
      request<{ user: { id: string; email: string; role: 'admin' | 'member' | 'viewer' } }>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password, remember }) },
      ),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    me: () =>
      request<{ id: string; email: string; role: 'admin' | 'member' | 'viewer' }>('/auth/me'),
    listUsers: () =>
      request<
        Array<{
          id: string
          email: string
          role: string
          isActive: boolean
          createdAt: string
          lastLoginAt: string | null
        }>
      >('/auth/users'),
    inviteUser: (data: { email: string; password: string; role: string }) =>
      request<any>('/auth/users', { method: 'POST', body: JSON.stringify(data) }),
    updateUser: (id: string, data: { role?: string; isActive?: boolean; password?: string }) =>
      request<any>(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteUser: (id: string) => request<void>(`/auth/users/${id}`, { method: 'DELETE' }),
  },
  tasks: {
    list: (params?: { projectId?: string; stage?: string; status?: string }) => {
      const qs = new URLSearchParams()
      if (params?.projectId) qs.set('projectId', params.projectId)
      if (params?.stage) qs.set('stage', params.stage)
      if (params?.status) qs.set('status', params.status)
      const q = qs.toString()
      return request<any[]>(`/tasks${q ? '?' + q : ''}`)
    },
    get: (id: string) => request<any>(`/tasks/${id}`),
    create: (data: any) => request<any>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    updateStage: (id: string, stage: string) =>
      request<any>(`/tasks/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage }) }),
    delete: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
    analyze: (id: string) => request<any>(`/tasks/${id}/analyze`, { method: 'POST' }),
    approve: (id: string) => request<any>(`/tasks/${id}/approve`, { method: 'POST' }),
    comments: (id: string) => request<any[]>(`/tasks/${id}/comments`),
    addComment: (id: string, body: string) =>
      request<any>(`/tasks/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
    activities: (id: string) => request<any[]>(`/tasks/${id}/activities`),
    subtasks: (id: string, allTasks: any[]) => allTasks.filter((t: any) => t.parentTaskId === id),
    createSubtask: (id: string, data: any) =>
      request<any>(`/tasks/${id}/subtasks`, { method: 'POST', body: JSON.stringify(data) }),
    fixIssues: (id: string, issues: Array<{ title: string; severity: string; role?: string }>) =>
      request<{ created: any[] }>(`/tasks/${id}/fix-issues`, { method: 'POST', body: JSON.stringify({ issues }) }),
    attachments: (taskId: string) =>
      request<any[]>(`/tasks/${taskId}/attachments`),
    createAttachment: (taskId: string, data: { fileName: string; fileSize: number; mimeType: string }) =>
      request<{ id: string; uploadUrl: string; storageKey: string }>(`/tasks/${taskId}/attachments`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    downloadUrl: (taskId: string, attachmentId: string) =>
      request<{ url: string }>(`/tasks/${taskId}/attachments/${attachmentId}/url`),
    start: (id: string) =>
      request<{ ok: boolean; waveCount: number; pendingSessions: string[] }>(
        `/tasks/${id}/start`,
        { method: 'POST' },
      ),
  },
  projects: {
    list: () => request<any[]>('/projects'),
    create: (data: any) => request<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
    activate: (id: string) => request<any>(`/projects/${id}/activate`, { method: 'PATCH' }),
    update: (id: string, data: any) =>
      request<any>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
    github: (id: string) => request<any>(`/projects/${id}/github`),
    getDiskUsage: (id: string) =>
      request<{ bytes: number; human: string }>(`/projects/${id}/disk-usage`),
    getContext: (id: string) =>
      request<{ projectId: string; brief: string; autoContext: string; updatedAt: string | null }>(
        `/projects/${id}/context`,
      ),
    saveContext: (id: string, brief: string) =>
      request<{ ok: boolean; autoContext: string }>(
        `/projects/${id}/context`,
        { method: 'POST', body: JSON.stringify({ brief }) },
      ),
  },
  agents: {
    list: () => request<any[]>('/agents'),
    history: (limit = 100) => request<any[]>(`/agents/history?limit=${limit}`),
    dispatch: (data: {
      role: string
      workingDir: string
      prompt: string
      projectId?: string
      taskId?: string
      cli?: string
    }) => request<any>('/agents', { method: 'POST', body: JSON.stringify(data) }),
    stop: (id: string) => request<void>(`/agents/${id}`, { method: 'DELETE' }),
    session: (id: string) => request<any>(`/agents/sessions/${id}`),
    listRoles: () =>
      request<
        Array<{
          id: string
          slug: string
          name: string
          description: string | null
          keywords: string[]
          isBuiltin: boolean
        }>
      >('/agents/roles'),
    createRole: (data: {
      slug: string
      name: string
      description?: string
      systemPrompt?: string
      keywords?: string[]
    }) => request<any>('/agents/roles', { method: 'POST', body: JSON.stringify(data) }),
    updateRole: (slug: string, data: any) =>
      request<any>(`/agents/roles/${slug}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    deleteRole: (slug: string) => request<void>(`/agents/roles/${slug}`, { method: 'DELETE' }),
    metrics: (sinceHours = 24) => request<any>(`/agents/metrics?sinceHours=${sinceHours}`),
    metricsByProvider: (sinceHours = 24) =>
      request<{ sinceHours: number; perProvider: Array<{ provider: string; count: number; successCount: number; avgDurationMs: number }> }>(
        `/agents/metrics/by-provider?sinceHours=${sinceHours}`
      ),
  },
  github: {
    prs: (repo: string) => request<any[]>(`/github/prs?repo=${encodeURIComponent(repo)}`),
    createPr: (data: { repo: string; title: string; head: string; base?: string; body?: string }) =>
      request<any>('/github/prs', { method: 'POST', body: JSON.stringify(data) }),
    issues: (repo: string, state: 'open' | 'closed' | 'all' = 'open') =>
      request<any[]>(`/github/issues?repo=${encodeURIComponent(repo)}&state=${state}`),
    createIssue: (data: { repo: string; title: string; body?: string; labels?: string[] }) =>
      request<any>('/github/issues', { method: 'POST', body: JSON.stringify(data) }),
    commits: (repo: string) => request<any[]>(`/github/commits?repo=${encodeURIComponent(repo)}`),
  },
  settings: {
    get: () =>
      request<{
        github: {
          connected: boolean
          tokenPreview: string | null
          oauthEnabled: boolean
          user: { login: string; avatarUrl?: string } | null
        }
        cli?: { orchestratorUrl: string }
        reposBaseDir?: string | null
      }>('/settings'),
    testCli: () =>
      request<{ ok: boolean; version?: string; error?: string; cmd: string }>('/settings/claude/test'),
    saveReposBaseDir: (dir: string) =>
      request<{ ok: boolean }>('/settings/repos-base-dir', {
        method: 'POST',
        body: JSON.stringify({ dir }),
      }),
    resetReposBaseDir: () =>
      request<{ ok: boolean }>('/settings/repos-base-dir', { method: 'DELETE' }),
    saveToken: (ghToken: string) =>
      request<{ ok: boolean; user: { login: string; avatarUrl?: string } }>(
        '/settings/github/token',
        { method: 'POST', body: JSON.stringify({ token: ghToken }) },
      ),
    disconnect: () => request<void>('/settings/github/token', { method: 'DELETE' }),
    oauthStart: () => request<{ url: string }>('/settings/github/oauth/start'),
    listRepos: () =>
      request<
        Array<{
          id: number
          fullName: string
          name: string
          owner: string
          private: boolean
          description: string | null
          defaultBranch: string
          updatedAt: string | null
          htmlUrl: string
        }>
      >('/settings/github/repos'),
    syncRepos: (repos: string[], projectId?: string) =>
      request<{ project: any; syncedRepos: string[] }>('/settings/github/sync', {
        method: 'POST',
        body: JSON.stringify({ repos, projectId }),
      }),
    githubBranches: (repo: string) =>
      request<{ name: string; protected: boolean }[]>(
        `/settings/github/branches?repo=${encodeURIComponent(repo)}`
      ),
    listCliProviders: () =>
      request<Array<{ provider: string; enabled: boolean; isDefault: boolean; createdAt: string | null; updatedAt: string | null }>>('/settings/cli'),
    updateCliProvider: (provider: string, body: { enabled?: boolean; isDefault?: boolean }) =>
      request<{ provider: string; enabled: boolean; isDefault: boolean }>(`/settings/cli/${provider}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    testCliProvider: (provider: string) =>
      request<{ ok: boolean; version?: string; error?: string; cmd: string }>(`/settings/cli/${provider}/test`),
  },
  chat: {
    history: () => request<any[]>('/chat/history'),
    clear: () => request<void>('/chat/history', { method: 'DELETE' }),
    send: (data: {
      message: string
      workingDir?: string
      projectId?: string
      images?: Array<{ name: string; mimeType: string; data: string }>
      executionMode?: 'cloud' | 'local'
    }) =>
      request<{ user: any; lead: any; proposal: any | null }>('/chat', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    dispatch: (proposalId: string) =>
      request<{ confirm: any; dispatches: any[] }>('/chat/dispatch', {
        method: 'POST',
        body: JSON.stringify({ proposalId }),
      }),
    cancelProposal: (proposalId: string) =>
      request<void>(`/chat/proposal/${encodeURIComponent(proposalId)}`, { method: 'DELETE' }),
    newTopic: () =>
      request<{ marker: any }>('/chat/topic', { method: 'POST' }),
  },
  metrics: {
    health: () =>
      request<{
        tasks: number
        totalSessions: number
        last24h: { count: number; avgDurationMs: number; successRate: number }
        orchestrator: { ok: boolean; activeSessions: number }
      }>('/metrics/health'),
    tokens: () =>
      request<{
        inputTokens: number
        outputTokens: number
        totalTokens: number
        costUsd: number
      }>('/metrics/tokens'),
  },
  companion: {
    listTokens: () =>
      request<{ id: string; label: string; prefix: string; createdAt: string; lastSeenAt: string | null }[]>('/companion/tokens'),
    createToken: (label = 'default') =>
      request<{ id: string; prefix: string; token: string }>('/companion/tokens', {
        method: 'POST',
        body: JSON.stringify({ label }),
      }),
    revokeToken: (id: string) =>
      request<{ ok: boolean }>(`/companion/tokens/${id}`, { method: 'DELETE' }),
    status: () =>
      request<{ connected: boolean; connectedAt: string | null }>('/companion/status'),
    fsList: (path: string) =>
      request<{ entries: { name: string; type: 'dir' | 'file' }[] }>(
        `/companion/fs/list?path=${encodeURIComponent(path)}`
      ),
    fsStat: (path: string) =>
      request<{ exists: boolean; readable: boolean; type: 'dir' | 'file' | null }>(
        `/companion/fs/stat?path=${encodeURIComponent(path)}`
      ),
    homedir: () => request<{ path: string }>('/companion/fs/homedir'),
    agentStdout: (sessionId: string) =>
      request<{ output: string; running: boolean }>(`/companion/agent/stdout?sessionId=${encodeURIComponent(sessionId)}`),
    agentKill: (sessionId: string) =>
      request<{ ok: boolean }>('/companion/agent/kill', { method: 'POST', body: JSON.stringify({ sessionId }) }),
  },
}
