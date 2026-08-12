/**
 * Destructive project delete — type name to confirm; optional keep files.
 * Layout: shared .delete-confirm professional pattern.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk-server/shared';
import {
  Alert,
  Badge,
  Button,
  CheckboxField,
  Field,
  Modal } from '../../../shared/components/ui';
import { projectsApi } from '../api';

export interface ProjectDeleteDialogProps {
  project: ProjectDto | null;
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onDeleted: (result: {
    ok: boolean;
    notes?: string[];
    warnings?: string[];
  }) => void;
}

export function ProjectDeleteDialog({
  project,
  open,
  busy: parentBusy,
  onClose,
  onDeleted }: ProjectDeleteDialogProps) {
  const { t } = useTranslation();
  const [confirmName, setConfirmName] = useState('');
  const [removeFiles, setRemoveFiles] = useState(true);
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setConfirmName('');
      setRemoveFiles(true);
      setError(null);
    }
  }, [open, project?.id]);

  const busy = Boolean(parentBusy || localBusy);
  const nameOk = Boolean(project && confirmName.trim() === project.name.trim());

  async function submit() {
    if (!project || !nameOk) return;
    setLocalBusy(true);
    setError(null);
    try {
      const r = await projectsApi.remove(project.id, {
        confirmName: confirmName.trim(),
        removeFiles });
      onDeleted(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.deleteFailed'));
    } finally {
      setLocalBusy(false);
    }
  }

  if (!project) return null;

  const impactItems = [
    t('projects.deleteWillStop'),
    t('projects.deleteWillWeb'),
    removeFiles ? t('projects.deleteWillOs') : t('projects.deleteKeepOs'),
    t('projects.deleteWillDb'),
  ];

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('projects.deleteDialogTitle')}
      description={t('projects.deleteDialogDesc', { name: project.name })}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="md"
            loading={busy}
            disabled={!nameOk}
            onClick={() => void submit()}
          >
            {t('projects.deletePermanent')}
          </Button>
        </>
      }
    >
      <div className="delete-confirm">
        <section
          className="delete-confirm__impact"
          aria-label={t('dialogs.severity.consequencesTitle')}
        >
          <header className="delete-confirm__section-head">
            <span className="delete-confirm__section-label">
              {t('dialogs.severity.consequencesTitle')}
            </span>
          </header>
          <ul className="delete-confirm__impact-list">
            {impactItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="delete-confirm__meta">
          <div className="delete-confirm__meta-grid">
            <div className="delete-confirm__meta-cell">
              <span className="delete-confirm__meta-lab">{t('projects.name')}</span>
              <span className="delete-confirm__meta-val">
                <code className="delete-confirm__code">{project.name}</code>
              </span>
            </div>
            <div className="delete-confirm__meta-cell">
              <span className="delete-confirm__meta-lab">domain</span>
              <span className="delete-confirm__meta-val">
                {project.domain || '—'}
              </span>
            </div>
            <div className="delete-confirm__meta-cell">
              <span className="delete-confirm__meta-lab">linux_user</span>
              <span className="delete-confirm__meta-val">
                <code className="delete-confirm__code">{project.linuxUser}</code>
              </span>
            </div>
            <div className="delete-confirm__meta-cell">
              <span className="delete-confirm__meta-lab">runtime</span>
              <span className="delete-confirm__meta-val">
                <Badge tone="info">
                  {project.runtime}
                  {project.runtimeVersion ? ` ${project.runtimeVersion}` : ''}
                </Badge>
              </span>
            </div>
            <div className="delete-confirm__meta-cell u-col-span-full">
              <span className="delete-confirm__meta-lab">home</span>
              <span className="delete-confirm__meta-val">
                <code className="delete-confirm__code">{project.homeDir}</code>
              </span>
            </div>
          </div>
        </section>

        <section className="delete-confirm__options">
          <CheckboxField
            id="del-files"
            label={t('projects.deleteRemoveFiles')}
            description={t('projects.deleteRemoveFilesDesc')}
            checked={removeFiles}
            onChange={setRemoveFiles}
            disabled={busy}
          />
        </section>

        <section className="delete-confirm__type">
          <Field
            label={t('projects.deleteTypeName')}
            htmlFor="del-name"
            hint={t('projects.deleteTypeNameHint', { name: project.name, v0: project.name })}
            flush
          >
            <input
              id="del-name"
              className="input"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={project.name}
              autoComplete="off"
              disabled={busy}
              spellCheck={false}
              autoFocus
            />
          </Field>
        </section>

        {error ? <Alert variant="error">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
