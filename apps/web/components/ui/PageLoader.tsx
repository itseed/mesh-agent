import { IconLoader } from './IconLoader';

export function PageLoader() {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-[60vh] gap-4"
      role="status"
      aria-label="Loading"
    >
      <IconLoader size={80} />
      <span className="text-sm text-dim animate-pulse">Loading...</span>
    </div>
  );
}
