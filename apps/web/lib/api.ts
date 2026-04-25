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
}
