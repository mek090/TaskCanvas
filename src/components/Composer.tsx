import type { FormEvent } from 'react';
import type { Priority } from '../lib/types';

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
  return (
    <form className="composer" onSubmit={onSubmit}>
      <input
        value={draft.title}
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
        placeholder="New task title"
      />
      <textarea
        value={draft.description}
        onChange={(e) => onChange({ ...draft, description: e.target.value })}
        placeholder="Notes / checklist ideas"
      />
      <div className="row">
        <select
          value={draft.priority}
          onChange={(e) => onChange({ ...draft, priority: e.target.value as Priority })}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <input
          value={draft.tags}
          onChange={(e) => onChange({ ...draft, tags: e.target.value })}
          placeholder="tags"
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
      <button type="submit">+ Add Task</button>
    </form>
  );
}
