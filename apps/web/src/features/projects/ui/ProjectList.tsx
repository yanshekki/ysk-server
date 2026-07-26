import type { ProjectDto } from '@ysk/shared';
import { Button,  EmptyState } from '../../../shared/components/ui';
import { ProjectListItem } from './ProjectListItem';

export interface ProjectListProps {
  items: ProjectDto[];
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}

export function ProjectList({ items, emptyTitle, emptyDescription, emptyAction }: ProjectListProps) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }
  return (
    <div className="list-panel" role="list">
      {items.map((p) => (
        <ProjectListItem key={p.id} project={p} />
      ))}
    </div>
  );
}
