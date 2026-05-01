import { Skeleton } from '@/components/ui/Skeleton';

const STAGE_TINTS = [
  { color: '#6a7a8e', bg: 'rgba(106,122,142,0.08)', border: 'rgba(106,122,142,0.2)' },
  { color: '#f0883e', bg: 'rgba(240,136,62,0.08)', border: 'rgba(240,136,62,0.25)' },
  { color: '#d2a8ff', bg: 'rgba(210,168,255,0.08)', border: 'rgba(210,168,255,0.25)' },
  { color: '#3fb950', bg: 'rgba(63,185,80,0.08)', border: 'rgba(63,185,80,0.25)' },
];

function TaskCardSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Skeleton width={6} height={6} rounded="full" />
        <Skeleton height={13} className="flex-1" />
      </div>
      <Skeleton width="80%" height={11} />
      <div className="flex items-center gap-1.5 mt-1">
        <Skeleton width={48} height={16} />
        <Skeleton width={36} height={11} />
      </div>
    </div>
  );
}

export function KanbanSkeleton({ cardsPerColumn = [3, 4, 2, 2] }: { cardsPerColumn?: number[] }) {
  return (
    <div role="status" aria-label="Loading board" className="flex gap-3 overflow-x-auto">
      {STAGE_TINTS.map((tint, i) => (
        <div key={i} className="flex flex-col min-w-[230px] flex-1">
          <div
            className="flex items-center justify-between mb-3 px-2 py-2 rounded-t border-b"
            style={{ borderColor: tint.border, backgroundColor: tint.bg }}
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tint.color }} />
              <Skeleton width={68} height={11} />
            </div>
            <Skeleton width={20} height={16} rounded="full" />
          </div>
          <div className="flex flex-col gap-2 flex-1 min-h-[200px] rounded-b p-1.5">
            {Array.from({ length: cardsPerColumn[i] ?? 2 }).map((_, j) => (
              <TaskCardSkeleton key={j} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
