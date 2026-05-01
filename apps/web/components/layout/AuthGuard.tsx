'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/Skeleton';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!initialized) return;
    if (!user) router.replace('/login');
  }, [initialized, user, router]);

  if (!initialized || !user) {
    return (
      <div className="min-h-screen bg-canvas flex" role="status" aria-label="Loading">
        <div className="w-56 shrink-0 border-r border-border p-3 hidden md:flex flex-col gap-2">
          <Skeleton width="60%" height={14} className="mb-3" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={28} rounded="md" />
          ))}
        </div>
        <div className="flex-1 p-6">
          <Skeleton width={140} height={16} />
          <Skeleton width={220} height={12} className="mt-2" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-lg p-4">
                <Skeleton width={56} height={26} />
                <Skeleton width="60%" height={12} className="mt-3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
