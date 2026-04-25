'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth'

const NAV = [
  {
    href: '/overview',
    label: 'Overview',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
        <rect x="1" y="1" width="5.5" height="5.5" rx="1"/>
        <rect x="8.5" y="1" width="5.5" height="5.5" rx="1"/>
        <rect x="1" y="8.5" width="5.5" height="5.5" rx="1"/>
        <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1"/>
      </svg>
    ),
  },
  {
    href: '/kanban',
    label: 'Kanban',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
        <rect x="1" y="1" width="3.5" height="13" rx="1"/>
        <rect x="5.75" y="1" width="3.5" height="13" rx="1"/>
        <rect x="10.5" y="1" width="3.5" height="13" rx="1"/>
      </svg>
    ),
  },
  {
    href: '/agents',
    label: 'Agents',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
        <circle cx="7.5" cy="7.5" r="2.5"/>
        <circle cx="7.5" cy="1.5" r="1.5"/>
        <circle cx="13" cy="10.5" r="1.5"/>
        <circle cx="2" cy="10.5" r="1.5"/>
        <line x1="7.5" y1="3" x2="7.5" y2="5" stroke="currentColor" strokeWidth="1.2"/>
        <line x1="9.6" y1="8.7" x2="11.7" y2="9.8" stroke="currentColor" strokeWidth="1.2"/>
        <line x1="5.4" y1="8.7" x2="3.3" y2="9.8" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
    ),
  },
  {
    href: '/github',
    label: 'GitHub',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
        <circle cx="4.5" cy="3" r="1.5"/>
        <circle cx="4.5" cy="12" r="1.5"/>
        <circle cx="10.5" cy="5.5" r="1.5"/>
        <path d="M4.5 4.5v6" stroke="currentColor" strokeWidth="1.3" fill="none"/>
        <path d="M4.5 4.5C4.5 8 10.5 7 10.5 5.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: '/projects',
    label: 'Projects',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M1.5 4C1.5 3.17 2.17 2.5 3 2.5H5.67L7 4H12C12.83 4 13.5 4.67 13.5 5.5V11.5C13.5 12.33 12.83 13 12 13H3C2.17 13 1.5 12.33 1.5 11.5V4Z"/>
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3">
        <circle cx="7.5" cy="7.5" r="2"/>
        <path d="M12.5 7.5l1-.4-.5-1.7-1.1.1a5 5 0 0 0-.6-1l.6-.9-1.3-1.2-.9.6a5 5 0 0 0-1-.6l.1-1.1L7.1 1l-.4 1A5 5 0 0 0 5.6 2.4l-.9-.6L3.4 3l.6.9a5 5 0 0 0-.6 1l-1.1-.1-.5 1.7 1 .4a5 5 0 0 0 0 1.2l-1 .4.5 1.7 1.1-.1a5 5 0 0 0 .6 1l-.6.9 1.3 1.2.9-.6a5 5 0 0 0 1 .6l-.1 1.1 1.7.5.4-1a5 5 0 0 0 1.2 0l.4 1 1.7-.5-.1-1.1a5 5 0 0 0 1-.6l.9.6 1.2-1.3-.6-.9a5 5 0 0 0 .6-1l1.1.1.5-1.7-1-.4a5 5 0 0 0 0-1.2z"/>
      </svg>
    ),
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { logout, user } = useAuth()
  const isAdmin = user?.role === 'admin'

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex flex-col bg-surface border-r border-border w-14 lg:w-[216px] transition-[width]">
      {/* Logo */}
      <div className="h-13 flex items-center px-3.5 border-b border-border shrink-0" style={{ height: 52 }}>
        <img src="/icon.svg" alt="" className="w-7 h-7 shrink-0" />
        <div className="ml-2.5 hidden lg:block overflow-hidden">
          <div className="text-[15px] font-semibold text-text leading-none tracking-tight">MeshAgent</div>
          <div className="text-[12px] text-muted mt-0.5 leading-none">AI Dev Team</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-0.5 p-2 pt-3">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`
                flex items-center gap-2.5 px-2.5 py-2 rounded text-[14px] font-medium transition-all
                ${active
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'text-muted hover:text-text hover:bg-white/[0.04] border border-transparent'}
              `}
            >
              <span className="shrink-0 w-4 flex items-center justify-center">{item.icon}</span>
              <span className="hidden lg:block">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* User info + sign out */}
      <div className="p-2 border-t border-border">
        {user && (
          <div className="px-2.5 py-1.5 hidden lg:block">
            <div className="text-[12px] text-text truncate">{user.email}</div>
            <div className="text-[11px] text-muted capitalize">{user.role}</div>
          </div>
        )}
        <button
          onClick={() => logout()}
          title="Sign out"
          className="flex items-center gap-2.5 px-2.5 py-2 rounded text-[14px] font-medium text-muted hover:text-danger hover:bg-danger/5 border border-transparent w-full transition-all"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0">
            <path d="M5 1.5H2.5C1.95 1.5 1.5 1.95 1.5 2.5V11.5C1.5 12.05 1.95 12.5 2.5 12.5H5"/>
            <path d="M9.5 10L12.5 7L9.5 4"/>
            <path d="M12.5 7H5"/>
          </svg>
          <span className="hidden lg:block">Sign out</span>
        </button>
      </div>
    </aside>
  )
}
