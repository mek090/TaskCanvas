import type { SortMode, TaskFilter } from '../lib/types';
import { SearchIcon } from './Icon';

const FILTERS: ReadonlyArray<{ key: TaskFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'due', label: 'Due' },
  { key: 'done', label: 'Done' },
  { key: 'trash', label: 'Trash' },
];

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  sortMode: SortMode;
  onSortChange: (s: SortMode) => void;
  showSort: boolean;
  counts: Partial<Record<TaskFilter, number>>;
};

export function SearchToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  sortMode,
  onSortChange,
  showSort,
  counts,
}: Props) {
  return (
    <div className="toolbar">
      <div className="search-box">
        <SearchIcon />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
        />
      </div>
      <div className="segmented" role="group" aria-label="Task filter">
        {FILTERS.map(({ key, label }) => {
          const count = counts[key];
          return (
            <button
              key={key}
              type="button"
              className={filter === key ? 'active' : ''}
              onClick={() => onFilterChange(key)}
              aria-pressed={filter === key}
              aria-label={key}
            >
              {label}
              {typeof count === 'number' && count > 0 && <span className="count">{count}</span>}
            </button>
          );
        })}
      </div>
      {showSort && (
        <div className="sort-bar">
          <span>Sort</span>
          <select
            aria-label="Sort tasks"
            value={sortMode}
            onChange={(e) => onSortChange(e.target.value as SortMode)}
          >
            <option value="due">Due date first</option>
            <option value="updated">Recently updated</option>
          </select>
        </div>
      )}
    </div>
  );
}
