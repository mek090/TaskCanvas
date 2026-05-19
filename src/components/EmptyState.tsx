import type { ComponentType, ReactNode, SVGProps } from 'react';
import { SparkleIcon } from './Icon';

type Props = {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  children: ReactNode;
};

export function EmptyState({ icon: IconComponent = SparkleIcon, title, children }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <IconComponent />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
