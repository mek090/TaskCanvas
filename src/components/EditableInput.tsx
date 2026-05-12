import { useEffect, useRef, useState } from 'react';

type Props = {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
};

export function EditableInput({ value, onCommit, placeholder }: Props) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(value);
  }, [value]);
  return (
    <input
      ref={ref}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
