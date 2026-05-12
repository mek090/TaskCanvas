import type { SortMode, TaskFilter } from '../lib/types';

const FILTERS: readonly TaskFilter[] = ['all', 'active', 'due', 'done', 'trash'] as const;

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  sortMode: SortMode;
  onSortChange: (s: SortMode) => void;
  showSort: boolean;
};

export function SearchToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  sortMode,
  onSortChange,
  showSort,
}: Props) {
  return (
    <div className="toolbar">
      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search tasks"
      />
      <div className="segmented">
        {FILTERS.map((name) => (
          <button
            className={filter === name ? 'active' : ''}
            onClick={() => onFilterChange(name)}
            key={name}
          >
            {name}
          </button>
        ))}
      </div>
      {showSort && (
        <label className="compact-label">
          Sort
          <select value={sortMode} onChange={(e) => onSortChange(e.target.value as SortMode)}>
            <option value="due">Due date first</option>
            <option value="updated">Recently updated</option>
          </select>
        </label>
      )}
    </div>
  );
}
