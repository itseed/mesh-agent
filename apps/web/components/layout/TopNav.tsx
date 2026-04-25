'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/overview', label: 'Overview' },
  { href: '/kanban', label: 'Kanban' },
  { href: '/agents', label: 'Agents' },
  { href: '/github', label: 'GitHub' },
  { href: '/projects', label: 'Projects' },
]

export function TopNav() {
  const pathname = usePathname()
  return (
    <nav className="bg-surface border-b border-border px-4 flex items-center gap-6 h-12 sticky top-0 z-50">
      <span className="text-accent font-bold text-sm mr-4">⬡ MeshAgent</span>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`text-sm pb-0.5 ${
            pathname.startsWith(item.href)
              ? 'text-white border-b-2 border-accent'
              : 'text-muted hover:text-white'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
