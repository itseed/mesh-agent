import { Skeleton } from '@/components/ui/Skeleton'

function StatCardSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <Skeleton width={56} height={26} />
      <Skeleton width="60%" height={12} className="mt-3" />
      <Skeleton width="40%" height={10} className="mt-2" />
    </div>
  )
}

export function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading overview">
      {/* Workflow guide skeleton */}
      <div className="mb-6 bg-surface border border-border rounded-xl p-4">
        <Skeleton width={84} height={10} className="mb-3" />
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 flex-1">
              <Skeleton width={28} height={28} rounded="full" />
              <div className="flex-1">
                <Skeleton width="55%" height={13} />
                <Skeleton width="80%" height={11} className="mt-1.5" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>

      {/* AI activity card */}
      <div className="bg-surface border border-border rounded-xl mb-6 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Skeleton width={6} height={6} rounded="full" />
            <Skeleton width={88} height={11} />
          </div>
          <Skeleton width={70} height={18} rounded="full" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-border">
          <div className="lg:col-span-3 p-5">
            <div className="grid grid-cols-4 gap-3 mb-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-canvas rounded-lg px-3 py-2.5 border border-border">
                  <Skeleton width="55%" height={18} />
                  <Skeleton width="70%" height={10} className="mt-2" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1.5">
                    <Skeleton width={90} height={11} />
                    <Skeleton width={50} height={11} />
                  </div>
                  <Skeleton height={4} rounded="full" />
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-2 p-5 flex flex-col gap-3">
            <Skeleton width={140} height={11} className="mb-1" />
            <div className="bg-canvas rounded-lg border border-border px-4 py-3">
              <Skeleton width="50%" height={28} />
              <Skeleton width="40%" height={11} className="mt-2" />
              <Skeleton height={4} rounded="full" className="mt-3" />
            </div>
            <div className="bg-canvas rounded-lg border border-border px-4 py-3">
              <Skeleton width="40%" height={22} />
              <Skeleton width="35%" height={11} className="mt-2" />
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline + recent activity row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 mb-4">
        <div className="lg:col-span-3 bg-surface border border-border rounded-lg p-4">
          <Skeleton width={100} height={11} className="mb-4" />
          <div className="flex items-center gap-6">
            <Skeleton width={120} height={120} rounded="full" />
            <div className="flex-1 flex flex-col gap-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton width={8} height={8} rounded="full" />
                  <Skeleton width="55%" height={12} />
                  <Skeleton width={32} height={12} className="ml-auto" />
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-border pt-3 mt-4">
            <Skeleton width={86} height={10} className="mb-2.5" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1.5">
                    <Skeleton width={70} height={12} />
                    <Skeleton width={40} height={12} />
                  </div>
                  <Skeleton height={8} rounded="full" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-surface border border-border rounded-lg p-4">
          <Skeleton width={110} height={11} className="mb-3" />
          <div className="flex flex-col divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="py-2.5 flex flex-col gap-1.5">
                <Skeleton width="80%" height={12} />
                <div className="flex items-center gap-2">
                  <Skeleton width={56} height={16} />
                  <Skeleton width={40} height={11} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
