import { useTranslation } from 'react-i18next';
import { Button, Card, CardSection, LogViewer } from '../../../shared/components/ui';

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
    <Card>
      <CardSection title={t('projects.sectionLogs')} description={t('projects.sectionLogsDesc')}>
        <div className="btn-row">
          <Button variant="secondary" size="md" loading={busy} onClick={onLoad}>
            {t('projects.viewLogs')}
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
              複製
            </Button>
          ) : null}
        </div>
        {files.length > 0 ? (
          <div className="btn-row u-mt-3" style={{ flexWrap: 'wrap' }}>
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
        ) : null}
        <LogViewer text={logTail} emptyLabel={t('projects.logsEmpty')} />
      </CardSection>
    </Card>
  );
}
