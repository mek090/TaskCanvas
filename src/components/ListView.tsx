import type { Priority, Todo } from '../lib/types';
import { priorityLabel } from '../lib/types';
import { normalizeDueDate } from '../lib/dates';
import { EditableInput } from './EditableInput';
import { EditableTextarea } from './EditableTextarea';
import { EmptyState } from './EmptyState';

type Props = {
  isTrashView: boolean;
  todos: Todo[];
  filteredTodos: Todo[];
  filteredDeletedTodos: Todo[];
  onUpdate: (id: string, patch: Partial<Todo>) => void;
  onToggle: (todo: Todo) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string, title: string) => void;
};

export function ListView({
  isTrashView,
  todos,
  filteredTodos,
  filteredDeletedTodos,
  onUpdate,
  onToggle,
  onDelete,
  onRestore,
  onPurge,
}: Props) {
  return (
    <div className="list-mode">
      {isTrashView ? (
        filteredDeletedTodos.length === 0 ? (
          <EmptyState icon="♻" title="Trash is empty">
            Soft-deleted tasks are held here until you restore them.
          </EmptyState>
        ) : (
          filteredDeletedTodos.map((todo) => (
            <article className="detail-card trash-detail" key={todo.id}>
              <div>
                <b>{todo.title}</b>
                <p>{todo.description || 'No description'}</p>
                <small>
                  <b className={`pill ${todo.priority}`}>{priorityLabel[todo.priority]}</b>
                  {todo.deleted_at ? ` · deleted ${new Date(todo.deleted_at).toLocaleString()}` : ''}
                </small>
              </div>
              <div className="trash-actions">
                <button className="primary" onClick={() => onRestore(todo.id)}>
                  Restore task
                </button>
                <button className="danger" onClick={() => onPurge(todo.id, todo.title)}>
                  Delete forever
                </button>
              </div>
            </article>
          ))
        )
      ) : filteredTodos.length === 0 ? (
        <EmptyState icon="✦" title={todos.length === 0 ? 'No tasks yet' : 'Nothing matches'}>
          {todos.length === 0
            ? 'Add your first task in the sidebar.'
            : 'Try clearing your search or switching filters.'}
        </EmptyState>
      ) : (
        filteredTodos.map((todo) => (
          <article className="detail-card" key={todo.id}>
            <EditableInput value={todo.title} onCommit={(v) => onUpdate(todo.id, { title: v })} />
            <EditableTextarea
              value={todo.description}
              onCommit={(v) => onUpdate(todo.id, { description: v })}
            />
            <div className="row">
              <select
                value={todo.priority}
                onChange={(e) => onUpdate(todo.id, { priority: e.target.value as Priority })}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <input
                aria-label={`Due date for ${todo.title}`}
                type="date"
                value={todo.due_date ?? ''}
                onChange={(e) => onUpdate(todo.id, { due_date: normalizeDueDate(e.target.value) })}
              />
              <button onClick={() => onToggle(todo)}>{todo.completed ? 'Mark active' : 'Complete'}</button>
              <button className="danger" onClick={() => onDelete(todo.id)}>
                Delete
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}
