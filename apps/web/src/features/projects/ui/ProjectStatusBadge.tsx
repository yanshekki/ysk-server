import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { Badge } from '../../../shared/components/ui';
import { deriveProjectStatus } from '../model/status';

export function ProjectStatusBadge({
  project,
  showHint }: {
  project: ProjectDto;
  showHint?: boolean;
}) {
  const { t } = useTranslation();
  const s = deriveProjectStatus(project);
  const label = t(s.labelKey, { defaultValue: s.labelFallback });
  const hint = s.hintKey
    ? t(s.hintKey, { defaultValue: s.hintFallback ?? '' })
    : s.hintFallback;

  return (
    <span>
      <Badge tone={s.tone}>{label}</Badge>
      {showHint && hint ? <p className="status-hint">{hint}</p> : null}
    </span>
  );
}
