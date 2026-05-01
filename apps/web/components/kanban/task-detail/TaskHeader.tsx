'use client';
import { PRIORITY_COLORS, STAGE_COLORS } from './styles';

interface TaskHeaderProps {
  localTask: any;
  executionMode: 'cloud' | 'local';
  onChangeExecutionMode: (m: 'cloud' | 'local') => void;
  starting: boolean;
  onStart: () => void;
  confirmDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function TaskHeader({
  localTask,
  executionMode,
  onChangeExecutionMode,
  starting,
  onStart,
  confirmDelete,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  onClose,
}: TaskHeaderProps) {
  return (
    <div className="flex items-start gap-3 p-4 border-b border-border shrink-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          {localTask.priority && (
            <span
              className={`text-[12px] font-semibold uppercase tracking-wide ${
                PRIORITY_COLORS[localTask.priority] ?? 'text-dim'
              }`}
            >
              {localTask.priority}
            </span>
          )}
          {localTask.stage && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded font-medium"
              style={{
                color: STAGE_COLORS[localTask.stage] ?? '#6a7a8e',
                backgroundColor: `${STAGE_COLORS[localTask.stage] ?? '#6a7a8e'}20`,
              }}
            >
              {localTask.stage}
            </span>
          )}
        </div>
        <h2 className="text-[15px] font-semibold text-text leading-snug">{localTask.title}</h2>
      </div>

      {localTask.stage === 'backlog' && !confirmDelete && (
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex bg-canvas border border-border rounded overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => onChangeExecutionMode('cloud')}
              className={`px-2.5 py-1 transition-colors ${
                executionMode === 'cloud'
                  ? 'bg-accent/15 text-accent'
                  : 'text-muted hover:text-text'
              }`}
            >
              ☁ Cloud
            </button>
            <button
              type="button"
              onClick={() => onChangeExecutionMode('local')}
              className={`px-2.5 py-1 border-l border-border transition-colors ${
                executionMode === 'local'
                  ? 'bg-success/15 text-success'
                  : 'text-muted hover:text-text'
              }`}
            >
              💻 Local
            </button>
          </div>
          <button
            onClick={onStart}
            disabled={starting}
            className="text-[12px] px-2.5 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
            title="Let Lead analyze and dispatch agents"
          >
            {starting ? 'Starting…' : '▶ Start with Lead'}
          </button>
        </div>
      )}

      {confirmDelete ? (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[12px] text-danger">ลบ?</span>
          <button
            onClick={onDelete}
            className="text-[12px] text-danger border border-danger/30 px-2 py-1 rounded hover:bg-danger/10 transition-colors"
          >
            ยืนยัน
          </button>
          <button
            onClick={onCancelDelete}
            className="text-[12px] text-muted hover:text-text transition-colors"
          >
            ยกเลิก
          </button>
        </div>
      ) : (
        <button
          onClick={onConfirmDelete}
          className="text-dim hover:text-danger text-[13px] transition-colors shrink-0"
          title="Delete task"
        >
          🗑
        </button>
      )}
      <button
        onClick={onClose}
        className="text-muted hover:text-text text-[18px] leading-none mt-0.5 shrink-0"
      >
        ✕
      </button>
    </div>
  );
}
