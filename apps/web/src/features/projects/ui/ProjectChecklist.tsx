import { useTranslation } from 'react-i18next';
import type { ProjectDto } from 'ysk-server-shared';
import { buildProjectChecklist } from '../model/status';

export function ProjectChecklist({ project }: { project: ProjectDto }) {
  const { t } = useTranslation();
  const steps = buildProjectChecklist(project);

  return (
    <ul className="checklist" aria-label={t('projects.checklist.title')}>
      {steps.map((s) => {
        const mark = s.state === 'done' ? '✓' : s.state === 'warn' ? '!' : '○';
        const cls =
          s.state === 'done'
            ? 'checklist__item checklist__item--done'
            : s.state === 'warn'
              ? 'checklist__item checklist__item--warn'
              : 'checklist__item checklist__item--todo';
        return (
          <li key={s.id} className={cls}>
            <span className="checklist__mark" aria-hidden>
              {mark}
            </span>
            {t(s.labelKey, { defaultValue: s.labelFallback })}
          </li>
        );
      })}
    </ul>
  );
}
