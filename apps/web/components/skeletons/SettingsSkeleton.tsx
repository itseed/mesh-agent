import { Skeleton } from '@/components/ui/Skeleton'

function ProviderRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-3">
      <Skeleton width={8} height={8} rounded="full" />
      <div className="flex-1">
        <Skeleton width="40%" height={13} />
        <Skeleton width="60%" height={10} className="mt-1.5" />
      </div>
      <Skeleton width={36} height={20} rounded="full" />
    </div>
  )
}

export function SettingsSkeleton() {
  return (
    <div role="status" aria-label="Loading settings">
      {/* Tab bar */}
      <div className="flex gap-1 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} width={80} height={32} rounded="md" />
        ))}
      </div>

      {/* Primary section card */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <Skeleton width={120} height={14} />
          <Skeleton width={40} height={18} rounded="full" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <ProviderRowSkeleton key={i} />
          ))}
        </div>
      </div>

      {/* Secondary section card */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <Skeleton width={100} height={13} className="mb-4" />
        <div className="divide-y divide-border">
          {Array.from({ length: 2 }).map((_, i) => (
            <ProviderRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
