/**
 * Destructive project delete — type name to confirm; optional keep files.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import {
  Alert,
  Button,
  CheckboxField,
  Field,
  FormHint,
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

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('projects.deleteDialogTitle', { })}
      description={t('projects.deleteDialogDesc', {
        name: project.name })}
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
      <div className="u-stack u-gap-3">
        <Alert variant="warn">
          <ul className="u-text-sm u-mb-0" style={{ paddingLeft: '1.2rem' }}>
            <li>
              {t('projects.deleteWillStop', { })}
            </li>
            <li>
              {t('projects.deleteWillWeb', { })}
            </li>
            <li>
              {removeFiles
                ? t('projects.deleteWillOs', { })
                : t('projects.deleteKeepOs', { })}
            </li>
            <li>
              {t('projects.deleteWillDb', { })}
            </li>
          </ul>
        </Alert>

        <dl className="u-text-sm" style={{ margin: 0 }}>
          <div>
            <dt className="muted">{t('projects.name')}</dt>
            <dd>
              <code>{project.name}</code>
            </dd>
          </div>
          <div>
            <dt className="muted">domain</dt>
            <dd>{project.domain || '—'}</dd>
          </div>
          <div>
            <dt className="muted">linux_user</dt>
            <dd>
              <code>{project.linuxUser}</code>
            </dd>
          </div>
          <div>
            <dt className="muted">home</dt>
            <dd>
              <code className="u-text-sm">{project.homeDir}</code>
            </dd>
          </div>
          <div>
            <dt className="muted">runtime</dt>
            <dd>
              {project.runtime}
              {project.runtimeVersion ? ` ${project.runtimeVersion}` : ''}
            </dd>
          </div>
        </dl>

        <CheckboxField
          id="del-files"
          label={t('projects.deleteRemoveFiles', { })}
          description={t('projects.deleteRemoveFilesDesc', { })}
          checked={removeFiles}
          onChange={setRemoveFiles}
          disabled={busy}
        />

        <Field
          label={t('projects.deleteTypeName', { })}
          htmlFor="del-name"
          hint={t('projects.deleteTypeNameHint', {
            name: project.name })}
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
          />
        </Field>

        {error ? <Alert variant="error">{error}</Alert> : null}
        <FormHint>
          {t('projects.deleteDnsWarn', { })}
        </FormHint>
      </div>
    </Modal>
  );
}
