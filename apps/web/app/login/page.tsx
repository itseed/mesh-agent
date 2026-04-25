'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export default function LoginPage() {
  const { login } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { token } = await api.auth.login(email, password)
      login(token)
      router.push('/overview')
    } catch {
      setError('Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full bg-canvas/60 border border-border text-text text-[15px] rounded px-4 py-2.5 placeholder-dim transition-all focus:border-accent/60 focus:bg-canvas'

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background mesh icon (decorative) */}
      <img
        src="/icon.svg"
        alt=""
        aria-hidden
        className="absolute pointer-events-none select-none"
        style={{ width: 480, height: 480, opacity: 0.025, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
      />

      <div className="relative z-10 w-full max-w-[340px] px-4 fade-up">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src="/icon.svg" alt="MeshAgent" className="w-12 h-12 mb-3" />
          <div className="text-[17px] font-semibold text-text tracking-tight">MeshAgent</div>
          <div className="text-[13px] text-muted mt-1">AI Dev Team Orchestration</div>
        </div>

        {/* Form */}
        <div className="bg-surface/80 border border-border rounded-xl p-6 backdrop-blur-sm">
          <div className="text-[13px] font-medium text-muted mb-4 uppercase tracking-wider">Sign in</div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              required
              autoComplete="email"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              required
              autoComplete="current-password"
            />
            {error && (
              <p className="text-danger text-[14px] flex items-center gap-1.5">
                <span>✕</span> {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="mt-1 bg-accent/90 hover:bg-accent text-canvas text-[15px] font-semibold py-2.5 rounded transition-colors disabled:opacity-50"
            >
              {loading ? '…' : 'Sign in →'}
            </button>
          </form>
        </div>

        <p className="text-center text-[12px] text-dim mt-6">
          MeshAgent · Single-user mode
        </p>
      </div>
    </div>
  )
}
