/**
 * Project logs — list/search by filename + content keyword; extra scan dirs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { bindInput } from '../../../pages/bind-handlers';
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
          title={t('projects.sectionLogs', { defaultValue: t('projects.sectionLogs') })}
          description={t('projects.sectionLogsDesc', {
            defaultValue:
              t('projects.logsSectionDesc'),
          })}
        />

        <FormLayout columns={2}>
          <Field
            label={t('projects.logsNameSearch')}
            htmlFor="plog-name"
            hint={t('projects.logsNameSearchHint')}
            flush
          >
            <input
              id="plog-name"
              value={nameQ}
              onChange={bindInput(setNameQ)}
              placeholder="error.log"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runScan();
              }}
            />
          </Field>
          <Field
            label={t('projects.logsContentKw')}
            htmlFor="plog-grep"
            hint={t('projects.logsContentKwHint')}
            flush
          >
            <input
              id="plog-grep"
              value={grepQ}
              onChange={bindInput(setGrepQ)}
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
            {grepQ.trim() ? t('common.search') : t('projects.logsRescan')}
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
              {t('projects.logsRefreshFile')}
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
              {t('projects.logsCopy')}
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
              {t('projects.logsDownloadTail')}
            </Button>
          ) : null}
          <Link
            to={logCenterHref}
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
          >
            {t('system.scLogs')}
          </Link>
        </FormActions>

        {searchNotes.length ? (
          <FormHint>{searchNotes.join(' · ')}</FormHint>
        ) : null}

        {hits.length > 0 ? (
          <div className="u-mt-3">
            <FormHint>
              {t('projects.hitsFiles', { count: hits.length })}
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
                  title={t('projects.logsLinesHit', { count: h.matched })}
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
              {t('projects.logFilesCount', { count: filteredByLocalName.length })}
              {nameQ.trim() ? t('projects.logsNameFilter', { q: nameQ.trim() }) : ''}
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
              ? t('projects.logsScanning')
              : t('projects.logsNoneYet')}
          </FormHint>
        )}

        <div className="u-mt-4">
          <LogViewer
            text={logTail}
            emptyLabel={t('projects.logsEmpty', {
              defaultValue: t('projects.logsNoContent'),
            })}
          />
        </div>
      </Card>

      {related.length > 0 ? (
        <Card>
          <CardHeader
            title={t('projects.logsRelated')}
            description={t('projects.logsRelatedDesc')}
          />
          <ul className="plog-related">
            {related.map((r) => (
              <li key={r.id} className="plog-related__item">
                <Badge tone={r.available ? 'ok' : 'neutral'}>
                  {r.available ? t('common.available') : t('projects.logsMissing')}
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
                {t('projects.logsOpenInCenter')}
              </Link>
            </FormActions>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={t('projects.logsExtraDirs')}
          description={t('projects.logsExtraDirsDesc')}
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
            label={t('projects.logsDirList')}
            htmlFor="plog-dirs"
            hint={t('projects.logsDirListHint')}
            flush
            fullWidth
          >
            <textarea
              id="plog-dirs"
              rows={3}
              value={dirsText}
              onChange={bindInput(setDirsText)}
              placeholder={'storage/logs\nvar/log'}
              disabled={busy || !onSaveExtraDirs}
              className="u-mono-input"
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
            {t('projects.logsReset')}
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
            {t('projects.logsSaveScan')}
          </Button>
        </FormActions>
        <FormHint>
          {t('projects.defaultScanNote')}
        </FormHint>
      </Card>
    </div>
  );
}
