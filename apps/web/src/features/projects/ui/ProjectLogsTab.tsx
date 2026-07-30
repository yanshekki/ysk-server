/**
 * Project logs — list/search by filename + content keyword; extra scan dirs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardHeader,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  LogViewer,
  PresetChips,
  Badge,

  buttonClassName,} from '../../../shared/components/ui';

export interface ProjectLogFile {
  name: string;
  bytes?: number;
  mtime?: string;
  root?: string;
  kind?: string;
}

export interface ProjectLogHit {
  file: string;
  lines: string[];
  matched: number;
}

export interface ProjectLogsTabProps {
  busy?: boolean;
  logTail: string;
  files?: ProjectLogFile[];
  selectedFile?: string;
  extraDirs?: string[];
  hits?: ProjectLogHit[];
  searchNotes?: string[];
  related?: Array<{
    id: string;
    kind: string;
    label: string;
    source: string;
    available: boolean;
    meta?: string;
  }>;
  onSelectFile?: (name: string, opts?: { grep?: string }) => void;
  onLoad: (opts?: { name?: string; grep?: string }) => void;
  onRefreshFile?: (opts?: { grep?: string }) => void;
  onSaveExtraDirs?: (dirs: string[]) => void | Promise<void>;
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
  extraDirs = [],
  hits = [],
  searchNotes = [],
  related = [],
  onSelectFile,
  onLoad,
  onRefreshFile,
  onSaveExtraDirs,
  autoLoad = true,
  projectId,
}: ProjectLogsTabProps) {
  const { t } = useTranslation();
  const loaded = useRef(false);

  const [nameQ, setNameQ] = useState('');
  const [grepQ, setGrepQ] = useState('');
  const [dirsText, setDirsText] = useState(extraDirs.join('\n'));

  useEffect(() => {
    setDirsText(extraDirs.join('\n'));
  }, [extraDirs]);

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

  const filteredByLocalName = useMemo(() => {
    // Server already filters by name when scanning; keep client filter for snappy UI
    const q = nameQ.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, nameQ]);

  function runScan() {
    onLoad({
      name: nameQ.trim() || undefined,
      grep: grepQ.trim() || undefined,
    });
  }

  return (
    <div className="tab-panel stack">
      <Card>
        <CardHeader
          title={t('projects.sectionLogs', { defaultValue: '應用日誌' })}
          description={t('projects.sectionLogsDesc', {
            defaultValue:
              '掃描 logs/、log/ 與額外目錄；可按檔名／內容關鍵字搜尋',
          })}
        />

        <FormLayout columns={2}>
          <Field
            label="檔名搜尋"
            htmlFor="plog-name"
            hint="匹配相對路徑，例如 error、app.out"
            flush
          >
            <input
              id="plog-name"
              value={nameQ}
              onChange={(e) => setNameQ(e.target.value)}
              placeholder="error.log"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runScan();
              }}
            />
          </Field>
          <Field
            label="內容關鍵字"
            htmlFor="plog-grep"
            hint="在各檔尾端搜尋（唔係全檔全文）"
            flush
          >
            <input
              id="plog-grep"
              value={grepQ}
              onChange={(e) => setGrepQ(e.target.value)}
              placeholder="Exception / error"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runScan();
              }}
            />
          </Field>
        </FormLayout>

        <FormActions>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={runScan}
          >
            {grepQ.trim() ? '搜尋' : '重新掃描'}
          </Button>
          {selectedFile ? (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() =>
                onRefreshFile?.({ grep: grepQ.trim() || undefined })
              }
            >
              重新整理此檔
            </Button>
          ) : null}
          {selectedFile && logTail ? (
            <Button
              variant="ghost"
              size="sm"
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
              size="sm"
              onClick={() => {
                const blob = new Blob([logTail], {
                  type: 'text/plain;charset=utf-8',
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = selectedFile.replace(/^~/, '') || 'log.txt';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              下載尾端
            </Button>
          ) : null}
          <Link
            to={logCenterHref}
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
          >
            日誌中心
          </Link>
        </FormActions>

        {searchNotes.length ? (
          <FormHint>{searchNotes.join(' · ')}</FormHint>
        ) : null}

        {hits.length > 0 ? (
          <div className="u-mt-3">
            <FormHint>
              內容命中 {hits.length} 個檔 — 點檔名可開尾端（含關鍵字過濾）
            </FormHint>
            <div className="chip-row u-mt-2">
              {hits.map((h) => (
                <button
                  key={h.file}
                  type="button"
                  className={`btn btn--sm ${
                    selectedFile === h.file ? 'btn--primary' : 'btn--secondary'
                  }`}
                  onClick={() =>
                    onSelectFile?.(h.file, {
                      grep: grepQ.trim() || undefined,
                    })
                  }
                  title={`${h.matched} 行命中`}
                >
                  {h.file} · {h.matched}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {filteredByLocalName.length > 0 ? (
          <div className="u-mt-4">
            <FormHint>
              日誌檔 {filteredByLocalName.length}
              {nameQ.trim() ? `（檔名含「${nameQ.trim()}」）` : ''}
              ：
            </FormHint>
            <div className="chip-row">
              {filteredByLocalName.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  className={`btn btn--sm ${
                    selectedFile === f.name ? 'btn--primary' : 'btn--secondary'
                  }`}
                  onClick={() =>
                    onSelectFile?.(f.name, {
                      grep: grepQ.trim() || undefined,
                    })
                  }
                  title={f.root ? `root: ${f.root}` : undefined}
                >
                  {f.name}
                  {f.bytes != null ? ` (${formatBytes(f.bytes)})` : ''}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <FormHint>
            {busy
              ? '正在掃描 logs…'
              : '尚無日誌檔 — 部署或跑過服務後會出現；亦可設定額外目錄。'}
          </FormHint>
        )}

        <div className="u-mt-4">
          <LogViewer
            text={logTail}
            emptyLabel={t('projects.logsEmpty', {
              defaultValue: '尚無內容',
            })}
          />
        </div>
      </Card>

      {related.length > 0 ? (
        <Card>
          <CardHeader
            title="相關來源"
            description="journal / nginx / PHP-FPM（詳見日誌中心）"
          />
          <ul className="plog-related">
            {related.map((r) => (
              <li key={r.id} className="plog-related__item">
                <Badge tone={r.available ? 'ok' : 'neutral'}>
                  {r.available ? '可用' : '未見'}
                </Badge>
                <strong>{r.label}</strong>
                <code className="muted u-text-sm">{r.meta || r.source}</code>
              </li>
            ))}
          </ul>
          {projectId ? (
            <FormActions>
              <Link
                to={`/logs?tab=explore&project=${encodeURIComponent(projectId)}`}
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              >
                在日誌中心開啟
              </Link>
            </FormActions>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="額外 log 目錄"
          description="相對專案 home 的路徑（除預設 logs/、log/ 外）"
        />
        <div className="u-mb-3">
          <PresetChips
            options={[
              { value: 'storage/logs', label: 'Laravel storage/logs' },
              { value: 'var/log', label: 'var/log' },
              { value: 'app/logs', label: 'app/logs' },
              { value: 'tmp', label: 'tmp' },
              {
                value: 'storage/logs\nvar/log',
                label: 'Laravel+var',
              },
            ]}
            value=""
            onChange={(v) => {
              if (!v) return;
              const add = v
                .split(/[\n,]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              setDirsText((prev) => {
                const cur = prev
                  .split(/[\n,]+/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                const merged = [...cur];
                for (const a of add) {
                  if (!merged.includes(a)) merged.push(a);
                }
                return merged.join('\n');
              });
            }}
            disabled={busy}
          />
        </div>
        <FormLayout>
          <Field
            label="目錄列表"
            htmlFor="plog-dirs"
            hint="一行一個；只允許 home 內相對路徑"
            flush
            fullWidth
          >
            <textarea
              id="plog-dirs"
              rows={3}
              value={dirsText}
              onChange={(e) => setDirsText(e.target.value)}
              placeholder={'storage/logs\nvar/log'}
              disabled={busy || !onSaveExtraDirs}
              style={{
                width: '100%',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                fontSize: '0.85rem',
              }}
            />
          </Field>
        </FormLayout>
        <FormActions align="end">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setDirsText(extraDirs.join('\n'))}
          >
            重設
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!onSaveExtraDirs}
            onClick={() => {
              const dirs = dirsText
                .split(/[\n,]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              void onSaveExtraDirs?.(dirs);
            }}
          >
            儲存並掃描
          </Button>
        </FormActions>
        <FormHint>
          預設永遠掃描 <code>logs/</code> 與 <code>log/</code>
          。額外目錄只收入檔名像 *.log / *.out / *.err 的檔。
        </FormHint>
      </Card>
    </div>
  );
}
