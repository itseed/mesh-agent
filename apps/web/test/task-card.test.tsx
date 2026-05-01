import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskCard } from '@/components/kanban/TaskCard';

const baseTask = {
  id: 't1',
  title: 'Fix login bug',
  priority: 'high',
  agentRole: 'frontend',
  stage: 'in_progress',
};

describe('TaskCard', () => {
  it('renders task title', () => {
    render(<TaskCard task={baseTask} />);
    expect(screen.getByText('Fix login bug')).toBeInTheDocument();
  });

  it('shows priority dot for high priority', () => {
    const { container } = render(<TaskCard task={baseTask} />);
    const dot = container.querySelector('span[style*="background-color"]');
    expect(dot).toBeInTheDocument();
  });

  it('shows agentRole chip', () => {
    render(<TaskCard task={baseTask} />);
    expect(screen.getByText('frontend')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<TaskCard task={baseTask} onClick={onClick} />);
    fireEvent.click(screen.getByText('Fix login bug'));
    expect(onClick).toHaveBeenCalled();
  });

  it('shows delete button on hover and calls onDelete', () => {
    const onDelete = vi.fn();
    render(<TaskCard task={baseTask} onDelete={onDelete} />);
    const deleteBtn = screen.getByRole('button');
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith('t1');
  });

  it('shows project chip when project provided', () => {
    const project = { id: 'p1', name: 'MeshAgent Web' };
    render(<TaskCard task={{ ...baseTask, projectId: 'p1' }} projects={[project]} />);
    expect(screen.getByText('MeshAgent Web')).toBeInTheDocument();
  });

  it('shows subtask count chip when subtasks exist', () => {
    const allTasks = [
      { id: 's1', parentTaskId: 't1', stage: 'done' },
      { id: 's2', parentTaskId: 't1', stage: 'in_progress' },
    ];
    render(<TaskCard task={baseTask} allTasks={allTasks} />);
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('does not show delete button when onDelete not provided', () => {
    render(<TaskCard task={baseTask} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
