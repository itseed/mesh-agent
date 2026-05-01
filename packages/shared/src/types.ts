export type KanbanStage = 'backlog' | 'in_progress' | 'review' | 'done';

export const AGENT_ROLES = [
  'frontend',
  'backend',
  'mobile',
  'devops',
  'designer',
  'qa',
  'reviewer',
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

/** @deprecated use AGENT_ROLES */
export const BUILTIN_AGENT_ROLES = AGENT_ROLES;
/** @deprecated use AgentRole */
export type BuiltinAgentRole = AgentRole;

export type AgentStatus = 'idle' | 'running' | 'error';

export type AgentSessionStatus = 'pending' | 'running' | 'completed' | 'errored' | 'killed';

export type UserRole = 'admin' | 'member' | 'viewer';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type CommentSource = 'user' | 'lead' | 'agent';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  stage: KanbanStage;
  status: TaskStatus;
  priority: TaskPriority;
  agentRole: AgentRole | null;
  wave: number;
  projectId: string | null;
  parentTaskId: string | null;
  githubPrUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskComment {
  id: string;
  taskId: string;
  authorId: string | null;
  source: CommentSource;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  currentTaskId: string | null;
  projectId: string | null;
}

export interface Project {
  id: string;
  name: string;
  paths: Record<string, string>;
  githubRepos: string[];
  isActive: boolean;
  createdAt: Date;
}

export interface AgentRoleDefinition {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
  keywords: string[];
  isBuiltin: boolean;
}
