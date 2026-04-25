'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface AuthCtx {
  token: string | null
  login: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    setToken(localStorage.getItem('token'))
  }, [])

  const login = (t: string) => {
    localStorage.setItem('token', t)
    setToken(t)
  }

  const logout = () => {
    localStorage.removeItem('token')
    setToken(null)
  }

  return <AuthContext.Provider value={{ token, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
