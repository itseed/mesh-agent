import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/lib/auth'
import { CommandBar } from '@/components/layout/CommandBar'

export const metadata: Metadata = {
  title: 'MeshAgent',
  description: 'AI Dev Team Orchestration Platform',
  manifest: '/manifest.json',
  themeColor: '#0d1117',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
          <CommandBar />
        </AuthProvider>
      </body>
    </html>
  )
}
