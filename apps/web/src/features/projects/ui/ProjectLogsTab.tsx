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
}: ProjectLogsTabProps) {
  const { t } = useTranslation();
  return (
    <div className="tab-panel">
      <Card>
        <CardSection
          title={t('projects.sectionLogs', { defaultValue: '執行日誌' })}
          description={t('projects.sectionLogsDesc', {
            defaultValue: '查看專案 logs 目錄下的檔案尾端',
          })}
        >
          <FormActions>
            <Button variant="primary" size="md" loading={busy} onClick={onLoad}>
              {t('projects.viewLogs', { defaultValue: '載入日誌' })}
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
            <FormHint>按「載入日誌」掃描專案 logs 目錄。</FormHint>
          )}

          <div className="u-mt-4">
            <LogViewer text={logTail} emptyLabel={t('projects.logsEmpty', { defaultValue: '尚無內容' })} />
          </div>
        </CardSection>
      </Card>
    </div>
  );
}
