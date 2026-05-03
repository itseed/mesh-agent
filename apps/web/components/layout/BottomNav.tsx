'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  {
    href: '/overview',
    label: 'Overview',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
        <rect x="1" y="1" width="5.5" height="5.5" rx="1" />
        <rect x="8.5" y="1" width="5.5" height="5.5" rx="1" />
        <rect x="1" y="8.5" width="5.5" height="5.5" rx="1" />
        <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
      </svg>
    ),
  },
  {
    href: '/kanban',
    label: 'Kanban',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
        <rect x="1" y="1" width="3.5" height="13" rx="1" />
        <rect x="5.75" y="1" width="3.5" height="13" rx="1" />
        <rect x="10.5" y="1" width="3.5" height="13" rx="1" />
      </svg>
    ),
  },
  {
    href: '/agents',
    label: 'Agents',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
        <circle cx="7.5" cy="7.5" r="2.5" />
        <circle cx="7.5" cy="1.5" r="1.5" />
        <circle cx="13" cy="10.5" r="1.5" />
        <circle cx="2" cy="10.5" r="1.5" />
        <line x1="7.5" y1="3" x2="7.5" y2="5" stroke="currentColor" strokeWidth="1.2" />
        <line x1="9.6" y1="8.7" x2="11.7" y2="9.8" stroke="currentColor" strokeWidth="1.2" />
        <line x1="5.4" y1="8.7" x2="3.3" y2="9.8" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    href: '/projects',
    label: 'Projects',
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 15 15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <path d="M1.5 4C1.5 3.17 2.17 2.5 3 2.5H5.67L7 4H12C12.83 4 13.5 4.67 13.5 5.5V11.5C13.5 12.33 12.83 13 12 13H3C2.17 13 1.5 12.33 1.5 11.5V4Z" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 sm:hidden bg-surface border-t border-border flex items-stretch h-14 safe-area-pb">
      {NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors"
            style={{ color: active ? 'var(--color-accent)' : undefined }}
          >
            <span className="w-5 h-5 flex items-center justify-center">{item.icon}</span>
            <span className={active ? 'text-accent' : 'text-muted'}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
