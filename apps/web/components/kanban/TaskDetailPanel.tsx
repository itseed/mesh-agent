'use client';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Task, TaskComment } from '@meshagent/shared';
import { api } from '@/lib/api';
import type { ReviewIssue } from './task-detail/styles';
import { parseReviewIssues } from './task-detail/utils';
import { TaskHeader } from './task-detail/TaskHeader';
import { OverviewTab } from './task-detail/OverviewTab';
import { CommentsTab } from './task-detail/CommentsTab';
import { SubtasksTab } from './task-detail/SubtasksTab';
import { ActivityTab } from './task-detail/ActivityTab';
import { AttachmentsTab } from './task-detail/AttachmentsTab';

interface TaskDetailPanelProps {
  task: Task;
  allTasks: Task[];
  onClose: () => void;
  onUpdate: () => void;
  onDelete: (id: string) => void;
}

type Tab = 'overview' | 'comments' | 'subtasks' | 'activity' | 'attachments';

const TABS: Tab[] = ['overview', 'comments', 'subtasks', 'activity', 'attachments'];
const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  comments: 'Comments',
  subtasks: 'Subtasks',
  activity: 'Activity',
  attachments: 'Files',
};

export function TaskDetailPanel({
  task,
  allTasks,
  onClose,
  onUpdate,
  onDelete,
}: TaskDetailPanelProps) {
  const [tab, setTab] = useState<Tab>('overview');
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [localTask, setLocalTask] = useState(task);
  const [descValue, setDescValue] = useState(task.description ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [subtaskRole, setSubtaskRole] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [expandedSubtaskId, setExpandedSubtaskId] = useState<string | null>(null);
  const [fixCommentId, setFixCommentId] = useState<string | null>(null);
  const [reviewIssues, setReviewIssues] = useState<ReviewIssue[]>([]);
  const [selectedIssues, setSelectedIssues] = useState<Set<number>>(new Set());
  const [fixingIssues, setFixingIssues] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [executionMode, setExecutionMode] = useState<'cloud' | 'local'>('cloud');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalTask(task);
    setDescValue(task.description ?? '');
  }, [task]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    api.tasks
      .comments(task.id)
      .then(setComments)
      .catch(() => {});
  }, [task.id, task.stage]);

  useEffect(() => {
    if (tab === 'activity') {
      api.tasks
        .activities(task.id)
        .then(setActivities)
        .catch(() => {});
    }
    if (tab === 'comments') {
      api.tasks
        .comments(task.id)
        .then(setComments)
        .catch(() => {});
    }
    if (tab === 'attachments') {
      api.tasks
        .attachments(task.id)
        .then(setAttachments)
        .catch(() => {});
    }
  }, [tab, task.id]);

  const subtasks = allTasks.filter((t) => t.parentTaskId === task.id);

  useEffect(() => {
    const running = subtasks.find((s) => s.stage === 'in_progress');
    if (running) {
      setTab('subtasks');
      setExpandedSubtaskId(running.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function saveDescription() {
    setEditingDesc(false);
    if (descValue === localTask.description) return;
    try {
      await api.tasks.update(task.id, { description: descValue });
      setLocalTask((prev) => ({ ...prev, description: descValue }));
      onUpdate();
    } catch {}
  }

  async function updateField(field: string, value: string) {
    try {
      await api.tasks.update(task.id, { [field]: value });
      setLocalTask((prev) => ({ ...prev, [field]: value }));
      onUpdate();
    } catch {}
  }

  async function sendComment() {
    if (!commentText.trim()) return;
    setSending(true);
    try {
      await api.tasks.addComment(task.id, commentText.trim());
      setCommentText('');
      const fresh = await api.tasks.comments(task.id);
      setComments(fresh);
    } catch {
    } finally {
      setSending(false);
    }
  }

  async function analyze() {
    setAnalyzing(true);
    try {
      await api.tasks.analyze(task.id);
      const fresh = await api.tasks.comments(task.id);
      setComments(fresh);
      onUpdate();
    } catch {
    } finally {
      setAnalyzing(false);
    }
  }

  async function approve() {
    setApproving(true);
    try {
      await api.tasks.approve(task.id);
      onUpdate();
    } catch {
    } finally {
      setApproving(false);
    }
  }

  async function createSubtask(e: React.FormEvent) {
    e.preventDefault();
    if (!subtaskTitle.trim()) return;
    try {
      await api.tasks.createSubtask(task.id, {
        title: subtaskTitle.trim(),
        agentRole: subtaskRole || undefined,
      });
      setSubtaskTitle('');
      setSubtaskRole('');
      setShowSubtaskForm(false);
      onUpdate();
    } catch {}
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const { uploadUrl } = await api.tasks.createAttachment(task.id, {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
      });
      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      const fresh = await api.tasks.attachments(task.id);
      setAttachments(fresh);
    } catch (err: any) {
      setUploadError(err?.message ?? 'Upload ไม่สำเร็จ');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function openFixPanel(commentId: string, issues: ReviewIssue[]) {
    setFixCommentId(commentId);
    setReviewIssues(issues);
    setSelectedIssues(new Set(issues.map((_, i) => i)));
  }

  function openOverviewFix(issues: ReviewIssue[]) {
    setFixCommentId('__overview__');
    setReviewIssues(issues);
    setSelectedIssues(new Set(issues.map((_, i) => i)));
  }

  function toggleIssue(idx: number) {
    setSelectedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function selectAllIssues(issues: ReviewIssue[]) {
    setSelectedIssues(
      selectedIssues.size === issues.length ? new Set() : new Set(issues.map((_, i) => i)),
    );
  }

  function cancelFix() {
    setFixCommentId(null);
    setSelectedIssues(new Set());
  }

  async function confirmFix() {
    if (selectedIssues.size === 0) return;
    setFixError(null);
    setFixingIssues(true);
    try {
      const selected = reviewIssues.filter((_, i) => selectedIssues.has(i));
      const { created } = await api.tasks.fixIssues(task.id, selected);
      void created;
      setFixCommentId(null);
      setSelectedIssues(new Set());
      setTab('subtasks');
      onUpdate();
    } catch {
      setFixError('ไม่สามารถสร้าง fix tasks ได้ กรุณาลองใหม่');
    } finally {
      setFixingIssues(false);
    }
  }

  async function confirmFixAndStart() {
    if (selectedIssues.size === 0) return;
    setFixError(null);
    setFixingIssues(true);
    try {
      const selected = reviewIssues.filter((_, i) => selectedIssues.has(i));
      const { created } = await api.tasks.fixIssues(task.id, selected);
      setFixCommentId(null);
      setSelectedIssues(new Set());
      await Promise.allSettled(
        created.map((t: any) => api.tasks.start(t.id, { executionMode })),
      );
      setTab('subtasks');
      onUpdate();
    } catch {
      setFixError('ไม่สามารถสร้าง fix tasks ได้ กรุณาลองใหม่');
    } finally {
      setFixingIssues(false);
    }
  }

  const leadComment = comments.find((c) => c.source === 'lead');
  let plan: any = null;
  if (leadComment) {
    try {
      plan = JSON.parse(leadComment.body);
    } catch {}
  }

  async function handleStart() {
    setStarting(true);
    try {
      await api.tasks.start(task.id, { executionMode });
      setLocalTask((t) => ({ ...t, stage: 'in_progress' as const }));
      const fresh = await api.tasks.activities(task.id);
      setActivities(fresh);
    } catch (e: any) {
      alert(e.message ?? 'Start failed');
    } finally {
      setStarting(false);
    }
  }

  // Aggregate review issues from agent comments for the Task Complete CTA
  const allIssues: ReviewIssue[] = [];
  comments
    .filter((c) => c.source === 'agent')
    .forEach((c) => {
      parseReviewIssues(c.body).forEach((issue) => allIssues.push(issue));
    });
  const doneCount = subtasks.filter((s) => s.stage === 'done').length;
  const totalCount = subtasks.length;
  const fixTasksCreatedCount = allIssues.length > 0
    ? allTasks.filter((t) => allIssues.some((issue) => t.title === `[Fix] ${issue.title}`)).length
    : 0;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/30 z-30" onClick={onClose} />

      <div className="fixed right-0 top-0 h-screen w-full sm:w-[480px] bg-surface border-l border-border-hi z-40 flex flex-col transition-transform duration-200">
        <TaskHeader
          localTask={localTask}
          executionMode={executionMode}
          onChangeExecutionMode={setExecutionMode}
          starting={starting}
          onStart={handleStart}
          confirmDelete={confirmDelete}
          onConfirmDelete={() => setConfirmDelete(true)}
          onCancelDelete={() => setConfirmDelete(false)}
          onDelete={async () => {
            await onDelete(task.id);
            onClose();
          }}
          onClose={onClose}
        />

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0 overflow-x-auto scrollbar-none">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[13px] px-4 py-2 border-b-2 transition-colors ${
                tab === t
                  ? 'border-accent text-text'
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div data-drawer-scroll className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4">
          {tab === 'overview' && (
            <OverviewTab
              localTask={localTask}
              descValue={descValue}
              editingDesc={editingDesc}
              onEditDesc={() => setEditingDesc(true)}
              onChangeDesc={setDescValue}
              onSaveDesc={saveDescription}
              onUpdateField={updateField}
              leadComment={leadComment}
              plan={plan}
              analyzing={analyzing}
              approving={approving}
              onAnalyze={analyze}
              onApprove={approve}
              doneCount={doneCount}
              totalCount={totalCount}
              allIssues={allIssues}
              fixCommentId={fixCommentId}
              fixTasksCreatedCount={fixTasksCreatedCount}
              selectedIssues={selectedIssues}
              fixingIssues={fixingIssues}
              fixError={fixError}
              onSwitchToSubtasks={() => setTab('subtasks')}
              onOpenOverviewFix={openOverviewFix}
              onToggleIssue={toggleIssue}
              onSelectAllIssues={selectAllIssues}
              onConfirmFix={confirmFix}
              onConfirmFixAndStart={confirmFixAndStart}
              onCancelFix={cancelFix}
            />
          )}

          {tab === 'comments' && (
            <CommentsTab
              comments={comments}
              fixCommentId={fixCommentId}
              selectedIssues={selectedIssues}
              fixingIssues={fixingIssues}
              onOpenFixPanel={openFixPanel}
              onToggleIssue={toggleIssue}
              onSelectAllIssues={selectAllIssues}
              onConfirmFix={confirmFix}
              onConfirmFixAndStart={confirmFixAndStart}
              onCancelFix={cancelFix}
            />
          )}

          {tab === 'subtasks' && (
            <SubtasksTab
              subtasks={subtasks}
              expandedSubtaskId={expandedSubtaskId}
              onToggleExpand={(id) => setExpandedSubtaskId(expandedSubtaskId === id ? null : id)}
              showSubtaskForm={showSubtaskForm}
              onShowSubtaskForm={setShowSubtaskForm}
              subtaskTitle={subtaskTitle}
              onSubtaskTitleChange={setSubtaskTitle}
              subtaskRole={subtaskRole}
              onSubtaskRoleChange={setSubtaskRole}
              onCreateSubtask={createSubtask}
            />
          )}

          {tab === 'activity' && <ActivityTab activities={activities} />}

          {tab === 'attachments' && (
            <AttachmentsTab
              attachments={attachments}
              uploading={uploading}
              uploadError={uploadError}
              fileInputRef={fileInputRef}
              onUpload={handleUpload}
            />
          )}
        </div>

        {/* Comment input (pinned bottom) */}
        {tab === 'comments' && (
          <div className="p-4 border-t border-border shrink-0">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Write a comment…"
              rows={2}
              className="w-full bg-canvas border border-border text-text text-[13px] rounded px-3 py-2 resize-none placeholder-dim mb-2"
            />
            <div className="flex justify-end">
              <button
                onClick={sendComment}
                disabled={sending || !commentText.trim()}
                className="bg-accent/15 hover:bg-accent/25 text-accent text-[13px] px-3 py-1.5 rounded border border-accent/20 disabled:opacity-40 transition-all"
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
