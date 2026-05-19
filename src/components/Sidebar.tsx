import type { FormEvent } from 'react';
import type { SortMode, TaskFilter, Todo } from '../lib/types';
import { priorityLabel } from '../lib/types';
import { dueLabel, isOverdue } from '../lib/dates';
import { Composer, type ComposerDraft } from './Composer';
import { SearchToolbar } from './SearchToolbar';
import { EmptyState } from './EmptyState';
import {
  CheckIcon,
  ClockIcon,
  InboxIcon,
  LogoIcon,
  RestoreIcon,
  SparkleIcon,
  TrashIcon,
} from './Icon';

type Props = {
  draft: ComposerDraft;
  onDraftChange: (next: ComposerDraft) => void;
  onCreate: (event: FormEvent) => void;
  query: string;
  onQueryChange: (q: string) => void;
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  sortMode: SortMode;
  onSortChange: (s: SortMode) => void;
  isTrashView: boolean;
  todos: Todo[];
  filteredTodos: Todo[];
  filteredDeletedTodos: Todo[];
  deletedCount: number;
  selectedTodoId: string | null;
  onSelectTodo: (id: string) => void;
  onToggleTodo: (todo: Todo) => void;
  onPlaceOnBoard: (todo: Todo) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string, title: string) => void;
};

export function Sidebar({
  draft,
  onDraftChange,
  onCreate,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  sortMode,
  onSortChange,
  isTrashView,
  todos,
  filteredTodos,
  filteredDeletedTodos,
  deletedCount,
  selectedTodoId,
  onSelectTodo,
  onToggleTodo,
  onPlaceOnBoard,
  onRestore,
  onPurge,
}: Props) {
  const counts: Partial<Record<TaskFilter, number>> = {
    all: todos.length,
    active: todos.filter((t) => !t.completed).length,
    due: todos.filter((t) => !t.completed && t.due_date).length,
    done: todos.filter((t) => t.completed).length,
    trash: deletedCount,
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo">
          <LogoIcon />
        </div>
        <div className="brand-text">
          <h1>TaskCanvas</h1>
          <span className="tagline">Local-first</span>
        </div>
      </div>

      <Composer draft={draft} onChange={onDraftChange} onSubmit={onCreate} />

      <SearchToolbar
        query={query}
        onQueryChange={onQueryChange}
        filter={filter}
        onFilterChange={onFilterChange}
        sortMode={sortMode}
        onSortChange={onSortChange}
        showSort={!isTrashView}
        counts={counts}
      />

      <div className="task-list">
        {isTrashView ? (
          filteredDeletedTodos.length === 0 ? (
            <EmptyState
              icon={TrashIcon}
              title={deletedCount === 0 ? 'Trash is empty' : 'No deleted tasks match'}
            >
              {deletedCount === 0
                ? 'Deleted tasks will live here so you can restore them later.'
                : 'Clear your search to see more deleted tasks.'}
            </EmptyState>
          ) : (
            filteredDeletedTodos.map((todo) => (
              <article className={`task-row trash-row prio-${todo.priority}`} key={todo.id}>
                <div className="trash-glyph" aria-hidden="true">
                  <TrashIcon />
                </div>
                <div className="task-row-body">
                  <span className="task-title">{todo.title}</span>
                  <span className="task-meta">
                    <b className={`pill ${todo.priority}`}>{priorityLabel[todo.priority]}</b>
                    {todo.deleted_at && (
                      <span className="meta-text">deleted {new Date(todo.deleted_at).toLocaleDateString()}</span>
                    )}
                  </span>
                </div>
                <div className="trash-actions">
                  <button
                    className="icon restore-btn"
                    onClick={() => onRestore(todo.id)}
                    aria-label="Restore"
                    title="Restore"
                  >
                    <RestoreIcon />
                  </button>
                  <button
                    className="icon purge-btn danger ghost"
                    onClick={() => onPurge(todo.id, todo.title)}
                    aria-label="Purge"
                    title="Delete forever"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </article>
            ))
          )
        ) : filteredTodos.length === 0 ? (
          <EmptyState
            icon={todos.length === 0 ? SparkleIcon : InboxIcon}
            title={todos.length === 0 ? 'No tasks yet' : 'Nothing matches'}
          >
            {todos.length === 0
              ? 'Type a title above and press Enter to add your first task.'
              : 'Try clearing your search or switching the filter.'}
          </EmptyState>
        ) : (
          filteredTodos.map((todo) => (
            <article
              className={`task-row prio-${todo.priority} ${selectedTodoId === todo.id ? 'selected' : ''} ${todo.completed ? 'completed' : ''}`}
              key={todo.id}
              onClick={() => onSelectTodo(todo.id)}
            >
              <button
                className={`check ${todo.completed ? 'done' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleTodo(todo);
                }}
                aria-label={todo.completed ? `Reopen ${todo.title}` : `Complete ${todo.title}`}
              >
                <CheckIcon />
              </button>
              <div className="task-row-body">
                <span className="task-title">{todo.title}</span>
                {todo.description && <span className="task-desc">{todo.description}</span>}
                <span className="task-meta">
                  {todo.due_date ? (
                    <b className={`due-pill ${isOverdue(todo) ? 'overdue' : ''}`}>
                      <ClockIcon />
                      {dueLabel(todo)}
                    </b>
                  ) : (
                    <b className={`pill ${todo.priority}`}>{priorityLabel[todo.priority]}</b>
                  )}
                  {todo.tags && <span className="meta-text">{todo.tags}</span>}
                </span>
              </div>
              <button
                className="board-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onPlaceOnBoard(todo);
                }}
                aria-label={`Place ${todo.title} on board`}
              >
                Board
              </button>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
