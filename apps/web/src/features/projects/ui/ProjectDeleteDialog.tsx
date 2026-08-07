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
  Modal,
} from '../../../shared/components/ui';
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
  onDeleted,
}: ProjectDeleteDialogProps) {
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
        removeFiles,
      });
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
      title={t('projects.deleteDialogTitle', {
        defaultValue: t('uiInline.s56f99a6b'),
      })}
      description={t('projects.deleteDialogDesc', {
        name: project.name,
        defaultValue: t('uiInline.sa0f2f5c6', { v0: project.name }),
      })}
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
            {t('projects.deletePermanent', { defaultValue: t('uiInline.sa6710b42') })}
          </Button>
        </>
      }
    >
      <div className="u-stack u-gap-3">
        <Alert variant="warn">
          <ul className="u-text-sm u-mb-0" style={{ paddingLeft: '1.2rem' }}>
            <li>
              {t('projects.deleteWillStop', {
                defaultValue: t('uiInline.s06569331'),
              })}
            </li>
            <li>
              {t('projects.deleteWillWeb', {
                defaultValue: t('uiInline.sd20a5b0c'),
              })}
            </li>
            <li>
              {removeFiles
                ? t('projects.deleteWillOs', {
                    defaultValue: t('uiInline.s4ff53acc'),
                  })
                : t('projects.deleteKeepOs', {
                    defaultValue: t('uiInline.s50dda2df'),
                  })}
            </li>
            <li>
              {t('projects.deleteWillDb', {
                defaultValue: t('uiInline.sa7f90a4a'),
              })}
            </li>
          </ul>
        </Alert>

        <dl className="u-text-sm" style={{ margin: 0 }}>
          <div>
            <dt className="muted">{t('projects.name', { defaultValue: t('uiInline.se0d24557') })}</dt>
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
          label={t('projects.deleteRemoveFiles', {
            defaultValue: t('uiInline.s9a9e4e32'),
          })}
          description={t('projects.deleteRemoveFilesDesc', {
            defaultValue: t('uiInline.s1cf2a97b'),
          })}
          checked={removeFiles}
          onChange={setRemoveFiles}
          disabled={busy}
        />

        <Field
          label={t('projects.deleteTypeName', {
            defaultValue: t('uiInline.s51af87fd'),
          })}
          htmlFor="del-name"
          hint={t('projects.deleteTypeNameHint', {
            name: project.name,
            defaultValue: t('uiInline.s8b04d62f', { v0: project.name }),
          })}
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
          {t('projects.deleteDnsWarn', {
            defaultValue: t('uiInline.s49d55c8f'),
          })}
        </FormHint>
      </div>
    </Modal>
  );
}
