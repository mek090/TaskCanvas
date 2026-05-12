import type { Priority, Todo } from '../lib/types';
import { dueLabel, isOverdue, normalizeDueDate } from '../lib/dates';
import { EditableInput } from './EditableInput';
import { EditableTextarea } from './EditableTextarea';
import { EmptyState } from './EmptyState';
import { TipsCard } from './TipsCard';

type Props = {
  selectedTodo: Todo | null;
  onUpdate: (id: string, patch: Partial<Todo>) => void;
  onToggle: (todo: Todo) => void;
  onDelete: (id: string) => void;
};

export function Inspector({ selectedTodo, onUpdate, onToggle, onDelete }: Props) {
  return (
    <aside className="inspector">
      <h2>Inspector</h2>
      {selectedTodo ? (
        <div className="inspector-form">
          <label>
            Title
            <EditableInput
              value={selectedTodo.title}
              onCommit={(v) => onUpdate(selectedTodo.id, { title: v })}
            />
          </label>
          <label>
            Description
            <EditableTextarea
              value={selectedTodo.description}
              onCommit={(v) => onUpdate(selectedTodo.id, { description: v })}
            />
          </label>
          <label>
            Priority
            <select
              value={selectedTodo.priority}
              onChange={(e) => onUpdate(selectedTodo.id, { priority: e.target.value as Priority })}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>
            Due date
            <input
              type="date"
              value={selectedTodo.due_date ?? ''}
              onChange={(e) => onUpdate(selectedTodo.id, { due_date: normalizeDueDate(e.target.value) })}
            />
          </label>
          {selectedTodo.due_date && (
            <div className={`due-summary ${isOverdue(selectedTodo) ? 'overdue' : ''}`}>
              {dueLabel(selectedTodo)}
            </div>
          )}
          <label>
            Tags
            <EditableInput
              value={selectedTodo.tags}
              onCommit={(v) => onUpdate(selectedTodo.id, { tags: v })}
            />
          </label>
          <button onClick={() => onToggle(selectedTodo)}>
            {selectedTodo.completed ? 'Reopen task' : 'Mark complete'}
          </button>
          <button className="danger" onClick={() => onDelete(selectedTodo.id)}>
            Delete task
          </button>
        </div>
      ) : (
        <EmptyState icon="◐" title="No task selected">
          Click a task in the sidebar to edit details here. Images pasted while a task is selected will
          link to it.
        </EmptyState>
      )}
      <TipsCard />
    </aside>
  );
}
