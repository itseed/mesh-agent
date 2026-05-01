import { Skeleton } from '@/components/ui/Skeleton';

export function ProjectListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading projects" className="flex flex-col gap-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-3 rounded-lg border border-transparent">
          <div className="flex items-center gap-1.5">
            <Skeleton width="65%" height={14} />
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <Skeleton width={48} height={11} />
            <Skeleton width={40} height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RepoListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading repos">
      <Skeleton height={32} className="mb-2" />
      <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton width={14} height={14} />
            <div className="flex-1">
              <Skeleton width="70%" height={12} />
              <Skeleton width="50%" height={10} className="mt-1.5" />
            </div>
            <Skeleton width={36} height={14} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GitHubTabSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading GitHub data" className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface border border-border rounded-lg p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <Skeleton width="75%" height={14} />
              <Skeleton width="40%" height={11} className="mt-2" />
            </div>
            <Skeleton width={48} height={18} rounded="full" />
          </div>
        </div>
      ))}
    </div>
  );
}
