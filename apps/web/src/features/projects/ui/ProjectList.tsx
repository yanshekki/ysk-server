import type { ProjectDto } from 'ysk-server-shared';
import { EmptyState } from '../../../shared/components/ui';
import { ProjectListItem } from './ProjectListItem';

export interface ProjectListProps {
  items: ProjectDto[];
  emptyTitle: string;
  emptyDescription?: string;
  onDelete?: (project: ProjectDto) => void;
}

export function ProjectList({
  items,
  emptyTitle,
  emptyDescription,
  onDelete,
}: ProjectListProps) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="list-panel" role="list">
      {items.map((p) => (
        <ProjectListItem key={p.id} project={p} onDelete={onDelete} />
      ))}
    </div>
  );
}
