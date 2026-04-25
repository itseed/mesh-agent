import { Sidebar } from './Sidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 pl-14 lg:pl-[216px] min-w-0">
        {children}
      </div>
    </div>
  )
}
