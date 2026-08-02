import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import {
  Button,
  Card,
  CardSection,
  Field,
  FormActions,
  FormHint,
  FormLayout,
} from '../../../shared/components/ui';
import { getProjectUiProfile } from '../model/runtime-ui';
import { projectsApi } from '../api';
import { bindInput, bindVoid } from '../../../pages/bind-handlers';

export interface ProjectAdvancedTabProps {
  project: ProjectDto;
  busy?: boolean;
  onBackup: () => void;
  onWordpress: () => void;
  onSuspend: () => void;
  onUnsuspend: () => void;
  /** Omit when caller lacks projects.delete */
  onDelete?: () => void;
  onOpsMessage?: (msg: string) => void;
}

export function ProjectAdvancedTab({
  project,
  busy,
  onBackup,
  onWordpress,
  onSuspend,
  onUnsuspend,
  onDelete,
  onOpsMessage,
}: ProjectAdvancedTabProps) {
  const { t } = useTranslation();
  const ui = getProjectUiProfile(project.runtime);
  const suspended = project.status === 'suspended';
  const [ftpUser, setFtpUser] = useState('');
  const [ftpPass, setFtpPass] = useState('');
  const [ftpBusy, setFtpBusy] = useState(false);

  async function createFtp() {
    setFtpBusy(true);
    try {
      const r = await projectsApi.createFtp(project.id, {
        username: ftpUser || undefined,
        password: ftpPass,
        homeSubdir: 'app',
      });
      onOpsMessage?.(
        r.ok
          ? t('projects.advFtpCreated', { user: String((r.account as { username?: string })?.username ?? '') })
          : (r.notes ?? []).join('；') || t('common.createFailed'),
      );
      if (r.ok) setFtpPass('');
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : t('projects.advFtpFailed'));
    } finally {
      setFtpBusy(false);
    }
  }

  return (
    <div className="tab-panel">
      <Card>
        <CardSection
          title={t('projects.sectionAdvanced', { defaultValue: t('projects.advMaintTitle') })}
          description={t('projects.sectionAdvancedDesc', {
            defaultValue: t('projects.advMaintDesc'),
          })}
        >
          <FormActions>
            <Button variant="secondary" size="md" loading={busy} onClick={onBackup}>
              {t('projects.backup', { defaultValue: t('projects.advBackupProject') })}
            </Button>
            {ui.showWordpress ? (
              <Button variant="secondary" size="md" loading={busy} onClick={onWordpress}>
                {t('projects.downloadWp', { defaultValue: t('projects.advOneClickWp') })}
              </Button>
            ) : null}
            {suspended ? (
              <Button variant="primary" size="md" loading={busy} onClick={onUnsuspend}>
                {t('projects.resume')}
              </Button>
            ) : (
              <Button variant="secondary" size="md" loading={busy} onClick={onSuspend}>
                {t('projects.suspend')}
              </Button>
            )}
          </FormActions>
          <FormHint>
            {suspended
              ? t('projects.advSuspendedHint')
              : t('projects.advSuspendHint')}
          </FormHint>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={t('projects.advFtpTitle')}
          description={t('projects.advFtpDesc')}
        >
          <FormLayout columns={2}>
            <Field
              label={t('common.username')}
              htmlFor="ftp-user"
              hint={t('projects.advFtpUserHint')}
              flush
            >
              <input
                id="ftp-user"
                value={ftpUser}
                onChange={bindInput(setFtpUser)}
                placeholder={`p_${project.linuxUser.replace(/^ysk_/, '')}`}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t('common.password')}
              htmlFor="ftp-pass"
              hint={t('projects.advFtpPassHint')}
              required
              flush
            >
              <input
                id="ftp-pass"
                type="password"
                value={ftpPass}
                onChange={bindInput(setFtpPass)}
                autoComplete="new-password"
              />
            </Field>
          </FormLayout>
          <FormActions>
            <Button
              variant="primary"
              size="md"
              loading={ftpBusy || busy}
              disabled={ftpPass.length < 8}
              onClick={bindVoid(createFtp)}
            >
              {t('ftp.createAccount')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                window.location.href = '/ftp/service';
              }}
            >
              {t('projects.goFtpsApply')}
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      <Card>
        <div className="danger-zone">
          <h3 className="danger-zone__title">
            {t('projects.dangerZone', { defaultValue: t('projects.advDangerTitle') })}
          </h3>
          <p className="danger-zone__desc">
            {t('projects.dangerZoneDesc', {
              defaultValue: t('projects.advDangerDesc'),
            })}
          </p>
          {onDelete ? (
            <FormActions>
              <Button variant="danger" size="md" loading={busy} onClick={onDelete}>
                {t('projects.delete', { defaultValue: t('projects.advDelete') })}
              </Button>
            </FormActions>
          ) : (
            <p className="muted u-text-sm">
              {t('rbac.cap.projectsDelete', { defaultValue: 'projects.delete required' })}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
