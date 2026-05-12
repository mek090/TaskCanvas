import type { FormEvent } from 'react';
import type { SortMode, TaskFilter, Todo } from '../lib/types';
import { priorityLabel } from '../lib/types';
import { dueLabel, isOverdue } from '../lib/dates';
import { Composer, type ComposerDraft } from './Composer';
import { SearchToolbar } from './SearchToolbar';
import { EmptyState } from './EmptyState';

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
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo">TC</div>
        <div>
          <h1>TaskCanvas</h1>
          <p>Local-first visual todo</p>
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
      />

      <div className="task-list">
        {isTrashView ? (
          filteredDeletedTodos.length === 0 ? (
            <EmptyState
              icon="♻"
              title={deletedCount === 0 ? 'Trash is empty' : 'No deleted tasks match'}
            >
              {deletedCount === 0
                ? 'Deleted tasks will appear here so you can restore them later.'
                : 'Try clearing your search to see more deleted tasks.'}
            </EmptyState>
          ) : (
            filteredDeletedTodos.map((todo) => (
              <article className={`task-row trash-row prio-${todo.priority}`} key={todo.id}>
                <div className="trash-glyph" aria-hidden="true">
                  ↺
                </div>
                <div className="task-row-body">
                  <strong>{todo.title}</strong>
                  <span>{todo.description || 'No description'}</span>
                  <small>
                    <b className={`pill ${todo.priority}`}>{priorityLabel[todo.priority]}</b>
                    {todo.deleted_at ? ` · deleted ${new Date(todo.deleted_at).toLocaleString()}` : ''}
                  </small>
                </div>
                <div className="trash-actions">
                  <button className="ghost" onClick={() => onRestore(todo.id)}>
                    Restore
                  </button>
                  <button className="danger ghost" onClick={() => onPurge(todo.id, todo.title)}>
                    Purge
                  </button>
                </div>
              </article>
            ))
          )
        ) : filteredTodos.length === 0 ? (
          <EmptyState
            icon="✦"
            title={todos.length === 0 ? 'No tasks yet' : 'Nothing matches'}
          >
            {todos.length === 0
              ? 'Add your first task above — give it a title and hit Add Task.'
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
              >
                {todo.completed ? '✓' : ''}
              </button>
              <div className="task-row-body">
                <strong>{todo.title}</strong>
                <span>{todo.description || 'No description'}</span>
                <small>
                  <b className={`pill ${todo.priority}`}>{priorityLabel[todo.priority]}</b>
                  {todo.due_date && (
                    <b className={`due-pill ${isOverdue(todo) ? 'overdue' : ''}`}>{dueLabel(todo)}</b>
                  )}
                  {todo.tags ? ` · ${todo.tags}` : ''}
                </small>
              </div>
              <button
                className="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onPlaceOnBoard(todo);
                }}
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
