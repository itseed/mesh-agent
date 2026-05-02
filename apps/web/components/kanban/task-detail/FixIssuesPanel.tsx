'use client';
import type { ReviewIssue } from './styles';
import { SEVERITY_STYLE } from './styles';

interface FixIssuesPanelProps {
  title?: string;
  issues: ReviewIssue[];
  selected: Set<number>;
  onToggle: (idx: number) => void;
  onSelectAll: () => void;
  onConfirm: () => void;
  onConfirmAndStart?: () => void;
  onCancel: () => void;
  busy?: boolean;
  showSelectAll?: boolean;
}

export function FixIssuesPanel({
  title = 'เลือก Issues',
  issues,
  selected,
  onToggle,
  onSelectAll,
  onConfirm,
  onConfirmAndStart,
  onCancel,
  busy,
  showSelectAll = true,
}: FixIssuesPanelProps) {
  return (
    <div className="border border-orange-400/20 rounded-lg p-3 bg-orange-400/5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] text-orange-300 font-semibold uppercase tracking-wide">
          {title}
        </div>
        {showSelectAll && (
          <button onClick={onSelectAll} className="text-[11px] text-dim hover:text-muted">
            {selected.size === issues.length ? 'Deselect All' : 'Select All'}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5 mb-3">
        {issues.map((issue, idx) => (
          <label key={idx} className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={selected.has(idx)}
              onChange={() => onToggle(idx)}
              className="shrink-0"
            />
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase shrink-0"
              style={SEVERITY_STYLE[issue.severity]}
            >
              {issue.severity}
            </span>
            <span className="text-[13px] text-text group-hover:text-white transition-colors">
              {issue.title}
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onConfirm}
          disabled={selected.size === 0 || busy}
          className="bg-orange-400/15 hover:bg-orange-400/25 border border-orange-400/25 text-orange-300 text-[13px] px-3 py-1.5 rounded transition-all disabled:opacity-40"
        >
          {busy ? '…' : `✓ Create ${selected.size} Fix Task${selected.size !== 1 ? 's' : ''}`}
        </button>
        {onConfirmAndStart && (
          <button
            onClick={onConfirmAndStart}
            disabled={selected.size === 0 || busy}
            className="bg-green-400/15 hover:bg-green-400/25 border border-green-400/25 text-green-300 text-[13px] px-3 py-1.5 rounded transition-all disabled:opacity-40"
          >
            {busy ? '…' : `🚀 Create & Auto-start`}
          </button>
        )}
        <button onClick={onCancel} className="text-muted text-[13px] hover:text-text">
          Cancel
        </button>
      </div>
    </div>
  );
}
