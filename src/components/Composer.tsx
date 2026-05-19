import { useState, type FormEvent } from 'react';
import type { Priority } from '../lib/types';
import { PlusIcon } from './Icon';

export type ComposerDraft = {
  title: string;
  description: string;
  priority: Priority;
  due_date: string;
  tags: string;
};

type Props = {
  draft: ComposerDraft;
  onChange: (next: ComposerDraft) => void;
  onSubmit: (event: FormEvent) => void;
};

export function Composer({ draft, onChange, onSubmit }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = draft.title.trim().length > 0;
  const showExpanded = expanded || hasContent;

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="composer-quick">
        <input
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          onFocus={() => setExpanded(true)}
          placeholder="New task title"
          aria-label="Task title"
        />
        <button
          type="submit"
          className="add-btn"
          disabled={!hasContent}
          aria-label="Add Task"
          title="Add Task"
        >
          <PlusIcon />
        </button>
      </div>
      {showExpanded && (
        <div className="composer-expand">
          <textarea
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
            placeholder="Notes / checklist ideas"
            aria-label="Notes"
          />
          <div className="composer-meta">
            <select
              aria-label="Priority"
              value={draft.priority}
              onChange={(e) => onChange({ ...draft, priority: e.target.value as Priority })}
            >
              <option value="low">Low priority</option>
              <option value="medium">Medium priority</option>
              <option value="high">High priority</option>
            </select>
            <input
              value={draft.tags}
              onChange={(e) => onChange({ ...draft, tags: e.target.value })}
              placeholder="tags"
              aria-label="Tags"
            />
          </div>
          <label className="compact-label">
            Due date
            <input
              type="date"
              value={draft.due_date}
              onChange={(e) => onChange({ ...draft, due_date: e.target.value })}
            />
          </label>
        </div>
      )}
    </form>
  );
}
