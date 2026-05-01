'use client'

export function ActivityTab({ activities }: { activities: any[] }) {
  if (activities.length === 0) {
    return <p className="text-muted text-[13px]">No activity yet.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {activities.map((a: any, i: number) => (
        <div key={a.id ?? i} className="flex gap-3 text-[13px]">
          <div className="w-1.5 h-1.5 rounded-full bg-dim mt-1.5 shrink-0" />
          <div className="flex-1">
            <span className="text-text">{a.type}</span>
            {a.payload != null && (
              <span className="text-muted ml-1.5">
                {typeof a.payload === 'string' ? a.payload : JSON.stringify(a.payload)}
              </span>
            )}
            {a.createdAt && (
              <div className="text-[11px] text-dim mt-0.5">
                {new Date(a.createdAt).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
