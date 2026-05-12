import type { ReactNode } from 'react';

type Props = {
  icon: string;
  title: string;
  children: ReactNode;
};

export function EmptyState({ icon, title, children }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
