export type KanbanStage = 'backlog' | 'in_progress' | 'review' | 'done'

export type AgentRole =
  | 'frontend'
  | 'backend'
  | 'mobile'
  | 'devops'
  | 'designer'
  | 'qa'
  | 'reviewer'

export type AgentStatus = 'idle' | 'running' | 'error'

export interface Task {
  id: string
  title: string
  description: string | null
  stage: KanbanStage
  agentRole: AgentRole | null
  projectId: string | null
  githubPrUrl: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Agent {
  id: string
  role: AgentRole
  status: AgentStatus
  currentTaskId: string | null
  projectId: string | null
}

export interface Project {
  id: string
  name: string
  paths: Record<string, string>
  githubRepos: string[]
  isActive: boolean
  createdAt: Date
}
