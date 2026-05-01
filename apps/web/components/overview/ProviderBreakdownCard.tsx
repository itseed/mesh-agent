'use client';

const PROVIDER_COLOR: Record<string, string> = {
  claude: '#facc15',
  gemini: '#60a5fa',
  cursor: '#4ade80',
};

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

interface ProviderRow {
  provider: string;
  count: number;
  successCount: number;
  avgDurationMs: number;
}

interface Props {
  perProvider: ProviderRow[];
  sinceHours: number;
  error?: string;
}

export function ProviderBreakdownCard({ perProvider, sinceHours, error }: Props) {
  const total = perProvider.reduce((s, r) => s + r.count, 0);

  const label =
    sinceHours === 24
      ? 'last 24 hours'
      : sinceHours % 24 === 0
        ? `last ${sinceHours / 24} days`
        : `last ${sinceHours}h`;

  return (
    <div className="bg-surface border border-border rounded-xl mb-6 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="text-[12px] font-semibold text-muted uppercase tracking-wider">
            Provider Breakdown
          </span>
        </div>
        <span className="text-[11px] text-dim">{label}</span>
      </div>

      <div className="p-5">
        {error ? (
          <p className="text-[13px] text-danger">Unable to load provider data</p>
        ) : perProvider.length === 0 ? (
          <p className="text-[13px] text-dim">No agent sessions in the last {sinceHours} hours</p>
        ) : (
          <div className="flex flex-col gap-4">
            {perProvider.map((row) => {
              const color = PROVIDER_COLOR[row.provider] ?? '#6a7a8e';
              const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
              const successRate =
                row.count > 0 ? Math.round((row.successCount / row.count) * 100) : 0;
              return (
                <div key={row.provider}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-[13px] font-medium text-text capitalize">
                        {row.provider}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-dim">
                        {row.count} {row.count === 1 ? 'session' : 'sessions'}
                      </span>
                      <span className="text-[11px] font-medium w-7 text-right" style={{ color }}>
                        {pct}%
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-border rounded-full overflow-hidden mb-1.5">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.75 }}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-dim">{successRate}% success</span>
                    <span className="text-dim text-[10px]">·</span>
                    <span className="text-[11px] text-dim">
                      avg {formatDuration(row.avgDurationMs)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
