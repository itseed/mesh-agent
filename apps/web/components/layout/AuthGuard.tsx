'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!initialized) return
    if (!user) router.replace('/login')
  }, [initialized, user, router])

  if (!initialized || !user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <span className="text-muted text-sm">Loading...</span>
      </div>
    )
  }

  return <>{children}</>
}
