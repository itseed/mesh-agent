const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

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
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? 'Request failed')
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ user: { id: string; email: string; role: 'admin' | 'member' | 'viewer' } }>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }) },
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
  },
  projects: {
    list: () => request<any[]>('/projects'),
    create: (data: any) => request<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
    activate: (id: string) => request<any>(`/projects/${id}/activate`, { method: 'PATCH' }),
    update: (id: string, data: any) =>
      request<any>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
    github: (id: string) => request<any>(`/projects/${id}/github`),
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
    }) => request<any>('/agents', { method: 'POST', body: JSON.stringify(data) }),
    stop: (id: string) => request<void>(`/agents/${id}`, { method: 'DELETE' }),
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
        cli?: { cmd: string; source: string }
      }>('/settings'),
    saveCliCmd: (cmd: string) =>
      request<{ ok: boolean }>('/settings/claude/cmd', {
        method: 'POST',
        body: JSON.stringify({ cmd }),
      }),
    resetCliCmd: () =>
      request<{ ok: boolean }>('/settings/claude/cmd', { method: 'DELETE' }),
    testCli: () =>
      request<{ ok: boolean; version?: string; error?: string; cmd: string }>('/settings/claude/test'),
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
  },
  chat: {
    history: () => request<any[]>('/chat/history'),
    clear: () => request<void>('/chat/history', { method: 'DELETE' }),
    send: (data: {
      message: string
      workingDir?: string
      projectId?: string
      images?: Array<{ name: string; mimeType: string; data: string }>
    }) =>
      request<{ user: any; lead: any; dispatches: any[] }>('/chat', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  metrics: {
    health: () =>
      request<{
        tasks: number
        totalSessions: number
        last24h: { count: number; avgDurationMs: number; successRate: number }
        orchestrator: { ok: boolean; activeSessions: number }
      }>('/metrics/health'),
  },
}
