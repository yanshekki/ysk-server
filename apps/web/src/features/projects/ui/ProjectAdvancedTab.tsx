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
          ? `FTP ${String((r.account as { username?: string })?.username ?? '')} 已建立（草稿，需到 FTPS 頁套用）`
          : (r.notes ?? []).join('；') || '建立失敗',
      );
      if (r.ok) setFtpPass('');
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : 'FTP 建立失敗');
    } finally {
      setFtpBusy(false);
    }
  }

  return (
    <div className="tab-panel">
      <Card>
        <CardSection
          title={t('projects.sectionAdvanced', { defaultValue: '維護操作' })}
          description={t('projects.sectionAdvancedDesc', {
            defaultValue: '備份、暫停／恢復、選用工具',
          })}
        >
          <FormActions>
            <Button variant="secondary" size="md" loading={busy} onClick={onBackup}>
              {t('projects.backup', { defaultValue: '備份本專案' })}
            </Button>
            {ui.showWordpress ? (
              <Button variant="secondary" size="md" loading={busy} onClick={onWordpress}>
                {t('projects.downloadWp', { defaultValue: '一鍵 WordPress（下載+設定）' })}
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
          </FormActions>
          <FormHint>
            {suspended
              ? '暫停中：進程已停、訪客會收到 503。'
              : '暫停會停止進程並將站點改為 503 維護頁。'}
          </FormHint>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title="專案 FTP（路徑 Jail）"
          description="帳戶限制在專案 app 目錄；建立後請到 FTPS 服務頁套用"
        >
          <FormLayout columns={2}>
            <Field
              label="用戶名"
              htmlFor="ftp-user"
              hint="可留空，系統自動產生"
              flush
            >
              <input
                id="ftp-user"
                value={ftpUser}
                onChange={(e) => setFtpUser(e.target.value)}
                placeholder={`p_${project.linuxUser.replace(/^ysk_/, '')}`}
                autoComplete="off"
              />
            </Field>
            <Field
              label="密碼"
              htmlFor="ftp-pass"
              hint="至少 8 個字元"
              required
              flush
            >
              <input
                id="ftp-pass"
                type="password"
                value={ftpPass}
                onChange={(e) => setFtpPass(e.target.value)}
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
              onClick={() => void createFtp()}
            >
              建立 FTP 帳戶
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                window.location.href = '/ftp/service';
              }}
            >
              前往 FTPS 服務套用
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      <Card>
        <div className="danger-zone">
          <h3 className="danger-zone__title">
            {t('projects.dangerZone', { defaultValue: '危險區域' })}
          </h3>
          <p className="danger-zone__desc">
            {t('projects.dangerZoneDesc', {
              defaultValue: '刪除專案無法從介面復原，請確認已備份。',
            })}
          </p>
          <FormActions>
            <Button variant="danger" size="md" loading={busy} onClick={onDelete}>
              {t('projects.delete', { defaultValue: '刪除專案' })}
            </Button>
          </FormActions>
        </div>
      </Card>
    </div>
  );
}
