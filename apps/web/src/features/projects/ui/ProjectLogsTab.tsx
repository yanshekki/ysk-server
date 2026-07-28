import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardSection,
  FormActions,
  FormHint,
  LogViewer,
} from '../../../shared/components/ui';

export interface ProjectLogFile {
  name: string;
  bytes?: number;
  mtime?: string;
}

export interface ProjectLogsTabProps {
  busy?: boolean;
  logTail: string;
  files?: ProjectLogFile[];
  selectedFile?: string;
  onSelectFile?: (name: string) => void;
  onLoad: () => void;
  onRefreshFile?: () => void;
  /** Auto-scan logs directory once when tab mounts (default true) */
  autoLoad?: boolean;
  /** Project id for deep-link to Log Center */
  projectId?: string;
}

function formatBytes(n?: number): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectLogsTab({
  busy,
  logTail,
  files = [],
  selectedFile,
  onSelectFile,
  onLoad,
  onRefreshFile,
  autoLoad = true,
  projectId,
}: ProjectLogsTabProps) {
  const { t } = useTranslation();
  const loaded = useRef(false);
  useEffect(() => {
    if (!autoLoad || loaded.current) return;
    loaded.current = true;
    onLoad();
  }, [autoLoad, onLoad]);

  const logCenterHref =
    projectId && selectedFile
      ? `/logs?tab=explore&project=${encodeURIComponent(projectId)}&source=${encodeURIComponent(`project:${projectId}:${selectedFile}`)}`
      : projectId
        ? `/logs?tab=explore&project=${encodeURIComponent(projectId)}`
        : '/logs?tab=explore&projectsOnly=1';

  return (
    <div className="tab-panel">
      <Card>
        <CardSection
          title={t('projects.sectionLogs', { defaultValue: '執行日誌' })}
          description={t('projects.sectionLogsDesc', {
            defaultValue: '查看專案 logs 目錄下的檔案尾端（進入分頁會自動掃描）',
          })}
        >
          <FormActions>
            <Button variant="primary" size="md" loading={busy} onClick={onLoad}>
              {t('projects.viewLogs', { defaultValue: '重新掃描' })}
            </Button>
            {selectedFile ? (
              <Button variant="secondary" size="md" loading={busy} onClick={onRefreshFile}>
                重新整理此檔
              </Button>
            ) : null}
            {selectedFile && logTail ? (
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  void navigator.clipboard?.writeText(logTail);
                }}
              >
                複製內容
              </Button>
            ) : null}
            {selectedFile && logTail ? (
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  const blob = new Blob([logTail], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = selectedFile || 'log.txt';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                下載尾端
              </Button>
            ) : null}
            <Link to={logCenterHref} className="btn btn--sm btn--ghost">
              日誌中心
            </Link>
          </FormActions>

          {files.length > 0 ? (
            <div className="u-mt-4">
              <FormHint>選擇要查看的日誌檔：</FormHint>
              <div className="chip-row">
                {files.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    className={`btn btn--sm ${selectedFile === f.name ? 'btn--primary' : 'btn--secondary'}`}
                    onClick={() => onSelectFile?.(f.name)}
                  >
                    {f.name}
                    {f.bytes != null ? ` (${formatBytes(f.bytes)})` : ''}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <FormHint>
              {busy ? '正在掃描 logs…' : '尚無日誌檔 — 部署或跑過服務後會出現。'}
            </FormHint>
          )}

          <div className="u-mt-4">
            <LogViewer text={logTail} emptyLabel={t('projects.logsEmpty', { defaultValue: '尚無內容' })} />
          </div>
        </CardSection>
      </Card>
    </div>
  );
}
