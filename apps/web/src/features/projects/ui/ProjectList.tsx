import type { ProjectDto } from '@yanshekki/shared';
import { EmptyState } from '../../../shared/components/ui';
import { ProjectListItem } from './ProjectListItem';

export interface ProjectListProps {
  items: ProjectDto[];
  emptyTitle: string;
  emptyDescription?: string;
}

export function ProjectList({
  items,
  emptyTitle,
  emptyDescription,
}: ProjectListProps) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="list-panel" role="list">
      {items.map((p) => (
        <ProjectListItem key={p.id} project={p} />
      ))}
    </div>
  );
}
