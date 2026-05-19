import type { Priority, Todo } from '../lib/types';
import { priorityLabel } from '../lib/types';
import { dueLabel, isOverdue, normalizeDueDate } from '../lib/dates';
import { EditableInput } from './EditableInput';
import { EditableTextarea } from './EditableTextarea';
import { EmptyState } from './EmptyState';
import { TipsCard } from './TipsCard';
import { CheckIcon, ClockIcon, RestoreIcon, SparkleIcon, TrashIcon } from './Icon';

type Props = {
  selectedTodo: Todo | null;
  onUpdate: (id: string, patch: Partial<Todo>) => void;
  onToggle: (todo: Todo) => void;
  onDelete: (id: string) => void;
};

const PRIORITIES: Priority[] = ['low', 'medium', 'high'];

export function Inspector({ selectedTodo, onUpdate, onToggle, onDelete }: Props) {
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span className="eyebrow">Inspector</span>
        {selectedTodo && (
          <span className={`pill ${selectedTodo.priority}`}>{priorityLabel[selectedTodo.priority]}</span>
        )}
      </div>
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
            <div className="segmented-priority" role="radiogroup" aria-label="Priority">
              {PRIORITIES.map((p) => (
                <button
                  type="button"
                  key={p}
                  data-prio={p}
                  className={selectedTodo.priority === p ? 'active' : ''}
                  onClick={() => onUpdate(selectedTodo.id, { priority: p })}
                  aria-checked={selectedTodo.priority === p}
                  role="radio"
                >
                  {priorityLabel[p]}
                </button>
              ))}
            </div>
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
              <ClockIcon />
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
          <div className="inspector-actions">
            <button
              className={`toggle-btn ${selectedTodo.completed ? '' : 'complete-btn'}`}
              onClick={() => onToggle(selectedTodo)}
            >
              {selectedTodo.completed ? <RestoreIcon /> : <CheckIcon />}
              <span style={{ marginLeft: 6 }}>{selectedTodo.completed ? 'Reopen task' : 'Mark complete'}</span>
            </button>
            <button className="danger" onClick={() => onDelete(selectedTodo.id)} aria-label="Delete task">
              <TrashIcon />
              <span style={{ marginLeft: 6 }}>Delete task</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <EmptyState icon={SparkleIcon} title="No task selected">
            Click any sidebar task to edit details here. Images pasted while a task is selected will link to it.
          </EmptyState>
          <TipsCard />
        </>
      )}
    </aside>
  );
}
