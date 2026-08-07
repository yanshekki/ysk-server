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
        defaultValue: '永久刪除專案',
      })}
      description={t('projects.deleteDialogDesc', {
        name: project.name,
        defaultValue: `將銷毀「${project.name}」。此操作無法還原。`,
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
            {t('projects.deletePermanent', { defaultValue: '永久刪除' })}
          </Button>
        </>
      }
    >
      <div className="u-stack u-gap-3">
        <Alert variant="warn">
          <ul className="u-text-sm u-mb-0" style={{ paddingLeft: '1.2rem' }}>
            <li>
              {t('projects.deleteWillStop', {
                defaultValue: '停止 systemd / PM2 / 本機進程',
              })}
            </li>
            <li>
              {t('projects.deleteWillWeb', {
                defaultValue: '移除 Nginx conf、PHP-FPM pool、Apache vhost（如有）',
              })}
            </li>
            <li>
              {removeFiles
                ? t('projects.deleteWillOs', {
                    defaultValue: '刪除 Linux 用戶與 home 目錄（安全路徑）',
                  })
                : t('projects.deleteKeepOs', {
                    defaultValue: '保留 home 與 Linux 用戶（僅面板移除）',
                  })}
            </li>
            <li>
              {t('projects.deleteWillDb', {
                defaultValue: '從控制面資料庫移除專案',
              })}
            </li>
          </ul>
        </Alert>

        <dl className="u-text-sm" style={{ margin: 0 }}>
          <div>
            <dt className="muted">{t('projects.name', { defaultValue: '名稱' })}</dt>
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
            defaultValue: '刪除磁碟 home 與 Linux 用戶',
          })}
          description={t('projects.deleteRemoveFilesDesc', {
            defaultValue: '取消勾選則只從面板移除，檔案與系統用戶保留',
          })}
          checked={removeFiles}
          onChange={setRemoveFiles}
          disabled={busy}
        />

        <Field
          label={t('projects.deleteTypeName', {
            defaultValue: '輸入專案名稱以確認',
          })}
          htmlFor="del-name"
          hint={t('projects.deleteTypeNameHint', {
            name: project.name,
            defaultValue: `請輸入「${project.name}」`,
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
            defaultValue: '共享 DNS zone / 郵箱 domain 不會自動刪除。',
          })}
        </FormHint>
      </div>
    </Modal>
  );
}
