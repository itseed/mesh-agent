'use client'
import { useState } from 'react'
import { AgentCard } from './AgentCard'
import { AgentOutputPanel } from './AgentOutputPanel'

interface AgentGridProps {
  agents: { id: string; role: string; status: string }[]
}

export function AgentGrid({ agents }: AgentGridProps) {
  const [selected, setSelected] = useState<{ id: string; role: string } | null>(null)

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            recentLines={[]}
            onClick={() => setSelected({ id: agent.id, role: agent.role })}
          />
        ))}
        {agents.length === 0 && (
          <div className="col-span-full py-16 text-center">
            <div className="text-[32px] opacity-10 mb-3">◎</div>
            <p className="text-muted text-[14px]">No agents running.</p>
            <p className="text-dim text-[13px] mt-1">Use the command bar below to dispatch one.</p>
          </div>
        )}
      </div>
      {selected && (
        <AgentOutputPanel
          sessionId={selected.id}
          role={selected.role}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
