'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, initialized, logout } = useAuth()
  const router = useRouter()
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    if (!initialized) return
    if (!token) {
      router.replace('/login')
      return
    }
    api.auth.me(token)
      .then(() => setVerified(true))
      .catch(() => {
        logout()
        router.replace('/login')
      })
  }, [initialized, token, logout, router])

  if (!initialized || !verified) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <span className="text-muted text-sm">Loading...</span>
      </div>
    )
  }

  return <>{children}</>
}
