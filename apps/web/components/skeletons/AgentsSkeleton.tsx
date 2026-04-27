import { Skeleton } from '@/components/ui/Skeleton'

function AgentCardSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton width={32} height={32} rounded="md" />
          <div>
            <Skeleton width={92} height={13} />
            <Skeleton width={56} height={10} className="mt-1.5" />
          </div>
        </div>
        <Skeleton width={32} height={11} />
      </div>
      <Skeleton width="90%" height={11} />
      <Skeleton width="65%" height={11} />
      <div className="flex flex-wrap gap-1 mt-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} width={48} height={18} />
        ))}
      </div>
    </div>
  )
}

function HistoryRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-surface border border-border rounded-lg">
      <Skeleton width={6} height={6} rounded="full" />
      <Skeleton width={64} height={18} />
      <Skeleton height={12} className="flex-1" />
      <Skeleton width={48} height={12} />
      <Skeleton width={36} height={12} />
      <Skeleton width={48} height={12} />
    </div>
  )
}

export function AgentsSkeleton({ cards = 8, rows = 5 }: { cards?: number; rows?: number }) {
  return (
    <div role="status" aria-label="Loading agents">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {Array.from({ length: cards }).map((_, i) => <AgentCardSkeleton key={i} />)}
      </div>
      <div className="mt-8">
        <Skeleton width={130} height={11} className="mb-3" />
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: rows }).map((_, i) => <HistoryRowSkeleton key={i} />)}
        </div>
      </div>
    </div>
  )
}
