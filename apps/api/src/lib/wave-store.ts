// apps/api/src/lib/wave-store.ts
import type { Redis } from 'ioredis';

export interface WaveRole {
  slug: string;
  reason?: string;
}

export interface LeadWave {
  roles: WaveRole[];
  brief: string;
}

export interface WaveCompletedSession {
  sessionId: string;
  role: string;
  success: boolean;
  summary: string;
  exitCode: number | null;
}

export interface WaveState {
  proposalId: string;
  waves: LeadWave[];
  currentWave: number;
  taskTitle: string;
  taskDescription: string;
  projectId: string | null;
  baseBranch: string;
  branchSuffix: string;
  createdBy: string;
  imagePaths: string[];
  pendingSessions: string[];
  completedSessions: WaveCompletedSession[];
  rootTaskId?: string; // NEW — task.id that triggered this wave run (for activity logging)
}

const WAVE_TTL = 86400; // 24 h

export const waveStateKey = (id: string) => `wave:state:${id}`;
export const sessionIndexKey = (id: string) => `wave:session:${id}`;

export async function saveWaveState(redis: Redis, state: WaveState): Promise<void> {
  await redis.set(waveStateKey(state.proposalId), JSON.stringify(state), 'EX', WAVE_TTL);
}

export async function getWaveState(redis: Redis, proposalId: string): Promise<WaveState | null> {
  const raw = await redis.get(waveStateKey(proposalId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WaveState;
  } catch {
    return null;
  }
}

export async function updateWaveState(redis: Redis, state: WaveState): Promise<void> {
  // KEEPTTL preserves remaining TTL without resetting the 24 h window
  await redis.set(waveStateKey(state.proposalId), JSON.stringify(state), 'KEEPTTL');
}

export async function deleteWaveState(redis: Redis, proposalId: string): Promise<void> {
  await redis.del(waveStateKey(proposalId));
}

export async function indexSession(
  redis: Redis,
  sessionId: string,
  proposalId: string,
): Promise<void> {
  await redis.set(sessionIndexKey(sessionId), proposalId, 'EX', WAVE_TTL);
}

export async function lookupSessionProposal(
  redis: Redis,
  sessionId: string,
): Promise<string | null> {
  return redis.get(sessionIndexKey(sessionId));
}

export async function removeSessionIndex(redis: Redis, sessionId: string): Promise<void> {
  await redis.del(sessionIndexKey(sessionId));
}
