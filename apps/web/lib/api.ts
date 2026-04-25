const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

async function request<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
      request<{ token: string }>('/auth/login', null, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: (token: string) => request<{ id: string; email: string }>('/auth/me', token),
  },
  tasks: {
    list: (token: string) => request<any[]>('/tasks', token),
    create: (token: string, data: { title: string; stage?: string; agentRole?: string; projectId?: string }) =>
      request<any>('/tasks', token, { method: 'POST', body: JSON.stringify(data) }),
    updateStage: (token: string, id: string, stage: string) =>
      request<any>(`/tasks/${id}/stage`, token, { method: 'PATCH', body: JSON.stringify({ stage }) }),
    delete: (token: string, id: string) =>
      request<void>(`/tasks/${id}`, token, { method: 'DELETE' }),
  },
  projects: {
    list: (token: string) => request<any[]>('/projects', token),
    create: (token: string, data: any) =>
      request<any>('/projects', token, { method: 'POST', body: JSON.stringify(data) }),
    activate: (token: string, id: string) =>
      request<any>(`/projects/${id}/activate`, token, { method: 'PATCH' }),
  },
  agents: {
    list: (token: string) => request<any[]>('/agents', token),
    dispatch: (token: string, data: { role: string; workingDir: string; prompt: string }) =>
      request<any>('/agents', token, { method: 'POST', body: JSON.stringify(data) }),
    stop: (token: string, id: string) =>
      request<void>(`/agents/${id}`, token, { method: 'DELETE' }),
  },
  github: {
    prs: (token: string, repo: string) => request<any[]>(`/github/prs?repo=${repo}`, token),
    commits: (token: string, repo: string) => request<any[]>(`/github/commits?repo=${repo}`, token),
  },
  settings: {
    get: (token: string) =>
      request<{
        github: {
          connected: boolean
          tokenPreview: string | null
          oauthEnabled: boolean
          user: { login: string; avatarUrl?: string } | null
        }
      }>('/settings', token),
    saveToken: (token: string, ghToken: string) =>
      request<{ ok: boolean; user: { login: string; avatarUrl?: string } }>(
        '/settings/github/token',
        token,
        { method: 'POST', body: JSON.stringify({ token: ghToken }) },
      ),
    disconnect: (token: string) =>
      request<void>('/settings/github/token', token, { method: 'DELETE' }),
    oauthStart: (token: string) =>
      request<{ url: string }>('/settings/github/oauth/start', token),
    listRepos: (token: string) =>
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
      >('/settings/github/repos', token),
    syncRepos: (token: string, repos: string[], projectId?: string) =>
      request<{ project: any; syncedRepos: string[] }>('/settings/github/sync', token, {
        method: 'POST',
        body: JSON.stringify({ repos, projectId }),
      }),
  },
  chat: {
    history: (token: string) => request<any[]>('/chat/history', token),
    clear: (token: string) =>
      request<void>('/chat/history', token, { method: 'DELETE' }),
    send: (
      token: string,
      data: {
        message: string
        workingDir?: string
        projectId?: string
        images?: Array<{ name: string; mimeType: string; data: string }>
      },
    ) =>
      request<{ user: any; lead: any; dispatches: any[] }>('/chat', token, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
}
