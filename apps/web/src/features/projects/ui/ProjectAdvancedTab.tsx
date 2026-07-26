import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { Button, Card, CardSection, Field, FormGrid } from '../../../shared/components/ui';
import { getProjectUiProfile } from '../model/runtime-ui';
import { projectsApi } from '../api';

export interface ProjectAdvancedTabProps {
  project: ProjectDto;
  busy?: boolean;
  onBackup: () => void;
  onWordpress: () => void;
  onSuspend: () => void;
  onUnsuspend: () => void;
  onDelete: () => void;
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
          ? `FTP ${String((r.account as { username?: string })?.username ?? '')} 已建立（draft，需到 FTP 服務頁套用）`
          : (r.notes ?? []).join('；') || '建立失敗',
      );
      if (r.ok) {
        setFtpPass('');
      }
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : 'FTP 建立失敗');
    } finally {
      setFtpBusy(false);
    }
  }

  return (
    <div className="stack">
      <Card>
        <CardSection title={t('projects.sectionAdvanced')} description={t('projects.sectionAdvancedDesc')}>
          <div className="btn-row">
            <Button variant="secondary" size="md" loading={busy} onClick={onBackup}>
              {t('projects.backup')}
            </Button>
            {ui.showWordpress ? (
              <Button variant="secondary" size="md" loading={busy} onClick={onWordpress}>
                {t('projects.downloadWp')}
              </Button>
            ) : null}
            {suspended ? (
              <Button variant="primary" size="md" loading={busy} onClick={onUnsuspend}>
                恢復專案
              </Button>
            ) : (
              <Button variant="secondary" size="md" loading={busy} onClick={onSuspend}>
                暫停專案
              </Button>
            )}
          </div>
          {suspended ? (
            <p className="muted u-text-sm u-mt-2">暫停中：進程已停、Nginx 回 503。</p>
          ) : (
            <p className="muted u-text-sm u-mt-2">暫停會停止進程並將站點改為 503。</p>
          )}
        </CardSection>
      </Card>

      <Card>
        <CardSection title="專案 FTP（Jail）" description="帳戶 jail 到專案 app 目錄；需到 FTP 服務頁套用 vsftpd">
          <FormGrid>
            <Field label="用戶名（可空=自動）" htmlFor="ftp-user" flush>
              <input
                id="ftp-user"
                value={ftpUser}
                onChange={(e) => setFtpUser(e.target.value)}
                placeholder={`p_${project.linuxUser.replace(/^ysk_/, '')}`}
              />
            </Field>
            <Field label="密碼（≥8）" htmlFor="ftp-pass" flush>
              <input
                id="ftp-pass"
                type="password"
                value={ftpPass}
                onChange={(e) => setFtpPass(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          </FormGrid>
          <div className="btn-row u-mt-3">
            <Button
              variant="primary"
              size="md"
              loading={ftpBusy || busy}
              disabled={ftpPass.length < 8}
              onClick={() => void createFtp()}
            >
              建立 FTP 帳戶
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                window.location.href = '/ftp/service';
              }}
            >
              前往 FTP 服務套用
            </Button>
          </div>
        </CardSection>
      </Card>

      <Card>
        <div className="danger-zone">
          <h3 className="danger-zone__title">{t('projects.dangerZone')}</h3>
          <p className="danger-zone__desc">{t('projects.dangerZoneDesc')}</p>
          <Button variant="danger" size="md" loading={busy} onClick={onDelete}>
            {t('projects.delete')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
