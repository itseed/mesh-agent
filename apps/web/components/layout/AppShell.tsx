import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 sm:pl-14 lg:pl-[216px] min-w-0 pb-16 sm:pb-0">{children}</div>
      <BottomNav />
    </div>
  );
}
