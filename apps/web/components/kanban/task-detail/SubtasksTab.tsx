'use client';
import type { FormEvent } from 'react';
import { ROLE_STYLE, STAGE_COLORS } from './styles';
import { SubtaskInlineOutput } from './SubtaskInlineOutput';

interface SubtasksTabProps {
  subtasks: any[];
  expandedSubtaskId: string | null;
  onToggleExpand: (id: string) => void;
  showSubtaskForm: boolean;
  onShowSubtaskForm: (show: boolean) => void;
  subtaskTitle: string;
  onSubtaskTitleChange: (v: string) => void;
  subtaskRole: string;
  onSubtaskRoleChange: (v: string) => void;
  onCreateSubtask: (e: FormEvent) => void;
}

export function SubtasksTab({
  subtasks,
  expandedSubtaskId,
  onToggleExpand,
  showSubtaskForm,
  onShowSubtaskForm,
  subtaskTitle,
  onSubtaskTitleChange,
  subtaskRole,
  onSubtaskRoleChange,
  onCreateSubtask,
}: SubtasksTabProps) {
  return (
    <div className="flex flex-col gap-2">
      {subtasks.length === 0 && !showSubtaskForm && (
        <p className="text-muted text-[13px]">No subtasks yet.</p>
      )}
      {subtasks.map((st: any) => {
        const role = ROLE_STYLE[st.agentRole ?? ''];
        const isRunning = st.stage === 'in_progress';
        const isExpanded = expandedSubtaskId === st.id;
        return (
          <div
            key={st.id}
            className="flex flex-col rounded border transition-colors overflow-hidden"
            style={{
              borderColor: isExpanded ? 'var(--color-border-hi)' : 'var(--color-border)',
              backgroundColor: 'var(--color-surface-2)',
            }}
          >
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer"
              onClick={() => onToggleExpand(st.id)}
            >
              {isRunning ? (
                <span className="relative inline-flex w-2 h-2 shrink-0">
                  <span
                    className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
                    style={{ backgroundColor: '#f0883e' }}
                  />
                  <span
                    className="relative inline-flex w-2 h-2 rounded-full"
                    style={{ backgroundColor: '#f0883e' }}
                  />
                </span>
              ) : (
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0"
                  style={{
                    color: STAGE_COLORS[st.stage] ?? '#6a7a8e',
                    backgroundColor: `${STAGE_COLORS[st.stage] ?? '#6a7a8e'}20`,
                  }}
                >
                  {st.stage ?? 'backlog'}
                </span>
              )}
              <span className="text-[13px] text-text flex-1">{st.title}</span>
              {st.agentRole && role && (
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded shrink-0"
                  style={{ backgroundColor: role.bg, color: role.text }}
                >
                  {st.agentRole}
                </span>
              )}
              <span className="text-dim text-[11px] shrink-0">{isExpanded ? '▲' : '▼'}</span>
            </div>

            {isExpanded && <SubtaskInlineOutput taskId={st.id} stage={st.stage} />}
          </div>
        );
      })}

      {showSubtaskForm ? (
        <form
          onSubmit={onCreateSubtask}
          className="flex flex-col gap-2 mt-1 p-3 bg-canvas rounded border border-border"
        >
          <input
            type="text"
            placeholder="Subtask title"
            value={subtaskTitle}
            onChange={(e) => onSubtaskTitleChange(e.target.value)}
            className="w-full bg-surface border border-border text-text text-[13px] rounded px-2 py-1.5 placeholder-dim"
            autoFocus
            required
          />
          <select
            value={subtaskRole}
            onChange={(e) => onSubtaskRoleChange(e.target.value)}
            className="w-full bg-surface border border-border text-text text-[13px] rounded px-2 py-1.5"
          >
            <option value="">No role</option>
            {Object.keys(ROLE_STYLE).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => onShowSubtaskForm(false)}
              className="text-muted text-[13px] hover:text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-accent/15 hover:bg-accent/25 text-accent text-[13px] px-3 py-1 rounded border border-accent/20"
            >
              Add
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => onShowSubtaskForm(true)}
          className="flex items-center gap-1.5 text-[13px] text-muted hover:text-accent transition-colors mt-1"
        >
          <span className="text-[16px] leading-none">+</span> Add subtask
        </button>
      )}
    </div>
  );
}
