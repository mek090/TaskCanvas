import type { Todo } from '../lib/types';
import { priorityLabel } from '../lib/types';
import { dueLabel, isOverdue } from '../lib/dates';
import { EmptyState } from './EmptyState';
import {
  CheckIcon,
  ClockIcon,
  InboxIcon,
  RestoreIcon,
  TrashIcon,
} from './Icon';

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
  onSelectTodo: (id: string) => void;
};

export function ListView({
  isTrashView,
  todos,
  filteredTodos,
  filteredDeletedTodos,
  onToggle,
  onDelete,
  onRestore,
  onPurge,
  onSelectTodo,
}: Props) {
  return (
    <div className="list-mode">
      {isTrashView ? (
        filteredDeletedTodos.length === 0 ? (
          <EmptyState icon={TrashIcon} title="Trash is empty">
            Soft-deleted tasks live here until you restore them.
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
        <EmptyState icon={InboxIcon} title={todos.length === 0 ? 'No tasks yet' : 'Nothing matches'}>
          {todos.length === 0
            ? 'Add your first task from the sidebar.'
            : 'Try clearing the search or switching filters.'}
        </EmptyState>
      ) : (
        filteredTodos.map((todo) => (
          <article
            className={`list-row prio-${todo.priority} ${todo.completed ? 'completed' : ''}`}
            key={todo.id}
            onClick={() => onSelectTodo(todo.id)}
          >
            <button
              className={`check ${todo.completed ? 'done' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(todo);
              }}
              aria-label={todo.completed ? `Reopen ${todo.title}` : `Complete ${todo.title}`}
            >
              <CheckIcon />
            </button>
            <div className="list-row-body">
              <span className="list-row-title">{todo.title}</span>
              {todo.description && <span className="list-row-desc">{todo.description}</span>}
              <span className="list-row-meta">
                <b className={`pill ${todo.priority}`}>{priorityLabel[todo.priority]}</b>
                {todo.due_date && (
                  <b className={`due-pill ${isOverdue(todo) ? 'overdue' : ''}`}>
                    <ClockIcon />
                    {dueLabel(todo)}
                  </b>
                )}
                {todo.tags && <span className="chip">{todo.tags}</span>}
              </span>
            </div>
            <div className="list-row-actions">
              <button
                className="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(todo);
                }}
                aria-label={todo.completed ? 'Mark active' : 'Complete'}
                title={todo.completed ? 'Mark active' : 'Mark complete'}
              >
                {todo.completed ? <RestoreIcon /> : <CheckIcon />}
              </button>
              <button
                className="icon danger-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(todo.id);
                }}
                aria-label="Delete"
                title="Delete"
              >
                <TrashIcon />
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}
