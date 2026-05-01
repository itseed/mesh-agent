'use client';
import { useState } from 'react';
import { AgentOutputPanel } from './AgentOutputPanel';
import { AgentRolePanel } from './AgentRolePanel';

const ROLE_COLOR: Record<string, string> = {
  frontend: '#22d3ee',
  backend: '#60a5fa',
  mobile: '#c084fc',
  devops: '#4ade80',
  designer: '#f472b6',
  qa: '#fb923c',
  reviewer: '#f87171',
  lead: '#facc15',
};

interface AgentGridProps {
  agents: { id: string; role: string; status: string }[];
  roles: any[];
  history: any[];
  projects: any[];
  onRefresh: () => void;
  onViewOutput: (sessionId: string, role: string) => void;
}

function RoleCard({
  role,
  session,
  onClick,
}: {
  role: any;
  session: { id: string; role: string; status: string } | null;
  onClick: () => void;
}) {
  const color = ROLE_COLOR[role.slug] ?? '#6a7a8e';
  const isRunning = !!session;
  const isPending = session?.status === 'pending';

  return (
    <div
      onClick={onClick}
      className={[
        'bg-surface border rounded-xl p-4 flex flex-col gap-3 transition-all cursor-pointer',
        isRunning
          ? 'border-success/30 shadow-[0_0_0_1px_rgba(63,185,80,0.1)] hover:border-success/50'
          : 'border-border hover:border-border-hi',
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0"
            style={{ backgroundColor: color + '15', color, border: '1px solid ' + color + '25' }}
          >
            {role.slug.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <div className="text-[13px] font-semibold text-text">{role.name}</div>
            <div className="text-[11px] text-muted">{role.slug}</div>
          </div>
        </div>
        {isRunning ? (
          <div className="flex items-center gap-1.5">
            <span className="relative flex w-2 h-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-50" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-success" />
            </span>
            <span className="text-[11px] text-success font-medium">
              {isPending ? 'Pending' : 'Running'}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-muted">Idle</span>
        )}
      </div>

      {role.description && (
        <p className="text-[12px] text-muted leading-relaxed line-clamp-2">{role.description}</p>
      )}

      {role.keywords?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {role.keywords.slice(0, 4).map((k: string) => (
            <span
              key={k}
              className="text-[11px] bg-surface-2 text-dim border border-border px-1.5 py-0.5 rounded"
            >
              {k}
            </span>
          ))}
          {role.keywords.length > 4 && (
            <span className="text-[11px] text-dim">+{role.keywords.length - 4}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentGrid({
  agents,
  roles,
  history,
  projects,
  onRefresh,
  onViewOutput,
}: AgentGridProps) {
  const [selected, setSelected] = useState<{ id: string; role: string } | null>(null);
  const [selectedRole, setSelectedRole] = useState<any | null>(null);

  if (roles.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="text-[32px] opacity-10 mb-3">◎</div>
        <p className="text-muted text-[14px]">No agent roles configured.</p>
        <p className="text-dim text-[13px] mt-1">Add skills in Settings to see your roster.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {roles.map((role) => {
          const session = agents.find(
            (a) => a.role === role.slug && (a.status === 'running' || a.status === 'pending'),
          );
          return (
            <RoleCard
              key={role.slug}
              role={role}
              session={session ?? null}
              onClick={() => setSelectedRole(role)}
            />
          );
        })}
      </div>
      {selected && (
        <AgentOutputPanel
          sessionId={selected.id}
          role={selected.role}
          onClose={() => setSelected(null)}
        />
      )}
      {selectedRole && (
        <AgentRolePanel
          role={selectedRole}
          session={
            agents.find(
              (a) =>
                a.role === selectedRole.slug && (a.status === 'running' || a.status === 'pending'),
            ) ?? null
          }
          history={history}
          projects={projects}
          onClose={() => setSelectedRole(null)}
          onDispatched={() => {
            setSelectedRole(null);
            onRefresh();
          }}
          onViewOutput={(sid, r) => {
            setSelectedRole(null);
            onViewOutput(sid, r);
          }}
        />
      )}
    </>
  );
}
