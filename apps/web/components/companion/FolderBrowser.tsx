'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface Entry {
  name: string;
  type: 'dir' | 'file';
}

interface FolderBrowserProps {
  initialPath?: string;
}

function buildBreadcrumbs(path: string): { label: string; path: string }[] {
  const parts = path.split('/').filter(Boolean);
  const crumbs = [{ label: '/', path: '/' }];
  parts.forEach((part, i) => {
    crumbs.push({ label: part, path: '/' + parts.slice(0, i + 1).join('/') });
  });
  return crumbs;
}

export function FolderBrowser({ initialPath = '/' }: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.companion.fsList(path);
      setEntries(res.entries);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(currentPath);
  }, [currentPath, load]);

  const crumbs = buildBreadcrumbs(currentPath);

  return (
    <div className="flex flex-col h-[360px] bg-canvas border border-border rounded-lg overflow-hidden">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-surface shrink-0 overflow-x-auto">
        {crumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-dim text-[11px]">/</span>}
            <button
              type="button"
              onClick={() => setCurrentPath(crumb.path)}
              className={`text-[11px] hover:text-accent transition-colors ${
                i === crumbs.length - 1 ? 'text-text font-medium' : 'text-muted'
              }`}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-[12px] text-dim animate-pulse">Loading…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <p className="text-[12px] text-danger text-center">{error}</p>
            <button
              type="button"
              onClick={() => load(currentPath)}
              className="text-[11px] text-accent hover:text-accent/80"
            >
              Retry
            </button>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-[12px] text-dim text-center py-8">Empty directory</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {entries.map((entry) => {
              const fullPath =
                currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
              const isDir = entry.type === 'dir';
              return (
                <div
                  key={entry.name}
                  draggable={isDir}
                  onDragStart={
                    isDir
                      ? (e) => {
                          e.dataTransfer.setData('text/plain', fullPath);
                          e.dataTransfer.effectAllowed = 'copy';
                        }
                      : undefined
                  }
                  onClick={isDir ? () => setCurrentPath(fullPath) : undefined}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-[12px] transition-colors ${
                    isDir
                      ? 'cursor-grab active:cursor-grabbing hover:bg-surface-2 text-text'
                      : 'opacity-40 cursor-default text-muted'
                  }`}
                >
                  <span className="shrink-0">{isDir ? '📁' : '📄'}</span>
                  <span className="flex-1 truncate font-mono">{entry.name}</span>
                  {isDir && <span className="text-[9px] text-dim shrink-0">drag</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-border bg-surface shrink-0">
        <p className="text-[10px] text-dim">Drag 📁 folders to role rows on the left</p>
      </div>
    </div>
  );
}
