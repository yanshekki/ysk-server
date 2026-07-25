import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto, OpsApplyResultDto } from '@ysk/shared';
import { projectsApi, useProjects } from '../features/projects';

export function ProjectsPage() {
  const { t } = useTranslation();
  const {
    items,
    error,
    setError,
    busy,
    setBusy,
    refresh,
    create,
    remove,
  } = useProjects();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [runtime, setRuntime] = useState<'node' | 'php' | 'static'>('node');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; description: string; runtime: string }>
  >([]);
  const [gitUrl, setGitUrl] = useState('');
  const [envText, setEnvText] = useState('NODE_ENV=production\n');
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProjectDto | null>(null);
  const [opsLog, setOpsLog] = useState<OpsApplyResultDto | null>(null);
  const [logTail, setLogTail] = useState<string>('');
  const [quotaMb, setQuotaMb] = useState('1024');
  const [memoryMax, setMemoryMax] = useState('512M');
  const [cpuQuota, setCpuQuota] = useState('100');

  useEffect(() => {
    void projectsApi
      .listTemplates()
      .then((r) => setTemplates(r.items))
      .catch(() => undefined);
  }, []);

  async function refreshAndSelect() {
    const list = await refresh();
    if (selected) {
      setSelected(list.find((p) => p.id === selected.id) ?? null);
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const project = await create({
        name,
        domain: domain || undefined,
        runtime,
        templateId: templateId || undefined,
      });
      setMsg(`Created ${project.name}${templateId ? ` (${templateId})` : ''}`);
      setName('');
      setDomain('');
      setSelected(project);
    } catch {
      /* error set by hook */
    }
  }

  async function onDelete(id: string) {
    try {
      await remove(id);
      if (selected?.id === id) {
        setSelected(null);
        setOpsLog(null);
      }
    } catch {
      /* error set by hook */
    }
  }

  async function runOps(
    action:
      | 'deploy'
      | 'deploy-php'
      | 'stop'
      | 'health'
      | 'publish-nginx'
      | 'git-deploy'
      | 'backup'
      | 'env',
    id: string,
  ) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      let result: OpsApplyResultDto;
      if (action === 'deploy') result = await projectsApi.deploy(id);
      else if (action === 'deploy-php') result = await projectsApi.deployPhp(id);
      else if (action === 'stop') result = await projectsApi.stop(id);
      else if (action === 'health') result = await projectsApi.health(id);
      else if (action === 'publish-nginx') result = await projectsApi.publishNginx(id);
      else if (action === 'git-deploy') {
        result = await projectsApi.gitDeploy(id, {
          gitUrl: gitUrl || undefined,
          redeploy: true,
        });
      } else if (action === 'backup') result = await projectsApi.backup(id);
      else {
        const env: Record<string, string> = {};
        for (const line of envText.split('\n')) {
          const tline = line.trim();
          if (!tline || tline.startsWith('#')) continue;
          const i = tline.indexOf('=');
          if (i > 0) env[tline.slice(0, i).trim()] = tline.slice(i + 1).trim();
        }
        result = await projectsApi.setEnv(id, env);
      }

      setOpsLog(result);
      setMsg(
        result.ok
          ? `${action} OK` + (result.url ? ` → ${result.url}` : '')
          : `${action} failed: ${result.notes?.slice(-1)[0] ?? 'see log'}`,
      );
      await refreshAndSelect();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-header">
        <h1>{t('projects.title')}</h1>
        <p>{t('projects.subtitle')}</p>
      </header>

      {error && <div className="alert alert--error">{error}</div>}
      {msg && <div className="alert alert--ok">{msg}</div>}

      <div className="card">
        <h2 className="card__title">{t('projects.create')}</h2>
        <form onSubmit={(e) => void onCreate(e)}>
          <div className="grid">
            <div className="field field--flush">
              <label htmlFor="pname">{t('projects.name')}</label>
              <input id="pname" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field field--flush">
              <label htmlFor="pdomain">{t('projects.domain')}</label>
              <input
                id="pdomain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="app.example.com"
              />
            </div>
            <div className="field field--flush">
              <label htmlFor="pruntime">Runtime</label>
              <select
                id="pruntime"
                value={runtime}
                onChange={(e) => setRuntime(e.target.value as 'node' | 'php' | 'static')}
              >
                <option value="node">Node.js</option>
                <option value="php">PHP</option>
                <option value="static">Static</option>
              </select>
            </div>
            <div className="field field--flush">
              <label htmlFor="ptpl">Template (optional)</label>
              <select
                id="ptpl"
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  const t = templates.find((x) => x.id === e.target.value);
                  if (t?.runtime === 'node' || t?.runtime === 'php' || t?.runtime === 'static') {
                    setRuntime(t.runtime);
                  }
                }}
              >
                <option value="">— none —</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {templateId && (
            <p className="muted u-text-sm">
              {templates.find((x) => x.id === templateId)?.description}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t('projects.create')}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="card__title">
          {t('projects.title')} ({items.length})
        </h2>
        {items.length === 0 ? (
          <div className="empty">
            <div className="empty__title">{t('projects.empty')}</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Port</th>
                  <th>Domain</th>
                  <th>PID</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className={selected?.id === p.id ? 'is-selected' : undefined}>
                    <td>
                      <button
                        type="button"
                        className="btn btn--link"
                        onClick={() => {
                          setSelected(p);
                          setOpsLog(null);
                        }}
                      >
                        <strong>{p.name}</strong>
                      </button>
                    </td>
                    <td>
                      <span
                        className={
                          p.processStatus === 'running' && p.status !== 'running_degraded'
                            ? 'badge badge--ok'
                            : p.status === 'running_degraded' || p.processStatus === 'running'
                              ? 'badge badge--warn'
                              : p.processStatus === 'unhealthy' || p.processStatus === 'failed'
                                ? 'badge badge--danger'
                                : 'badge'
                        }
                      >
                        {p.status === 'running_degraded'
                          ? 'running (degraded)'
                          : (p.processStatus ?? p.status ?? '—')}
                      </span>
                    </td>
                    <td className="muted">{p.port ?? '—'}</td>
                    <td className="muted">{p.domain ?? '—'}</td>
                    <td className="muted">{p.pid ?? '—'}</td>
                    <td>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={busy}
                          onClick={() => void runOps('deploy', p.id)}
                        >
                          {t('projects.deploy')}
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() => void runOps('health', p.id)}
                        >
                          {t('projects.health')}
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() => void onDelete(p.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="card">
          <h2 className="card__title">
            {t('projects.detail')}: {selected.name}
          </h2>
          <dl className="kv">
            <div>
              <dt>ID</dt>
              <dd>
                <code className="inline">{selected.id}</code>
              </dd>
            </div>
            <div>
              <dt>Home</dt>
              <dd>
                <code className="inline">{selected.homeDir}</code>
              </dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>
                <span className="badge">{selected.runtime}</span> {selected.runtimeVersion ?? ''}
              </dd>
            </div>
            <div>
              <dt>Process</dt>
              <dd>
                {selected.processStatus ?? '—'} · port {selected.port ?? '—'} · pid{' '}
                {selected.pid ?? '—'}
              </dd>
            </div>
            <div>
              <dt>Nginx</dt>
              <dd>
                <code className="inline">{selected.nginxConfigPath ?? '—'}</code>
              </dd>
            </div>
            <div>
              <dt>Last deploy</dt>
              <dd className="muted">{selected.lastDeployAt ?? '—'}</dd>
            </div>
            <div>
              <dt>Git</dt>
              <dd className="muted">
                {selected.gitUrl ?? '—'} {selected.gitCommit ? `@ ${selected.gitCommit.slice(0, 8)}` : ''}
              </dd>
            </div>
            <div>
              <dt>Backup</dt>
              <dd className="muted">
                {selected.lastBackupPath ?? '—'}
                {selected.lastBackupAt ? ` (${selected.lastBackupAt})` : ''}
              </dd>
            </div>
            <div>
              <dt>Last health</dt>
              <dd>
                <pre className="code">
                  {selected.lastHealth
                    ? JSON.stringify(selected.lastHealth, null, 2)
                    : '—'}
                </pre>
              </dd>
            </div>
          </dl>
          <div className="field">
            <label htmlFor="giturl">Git URL</label>
            <input
              id="giturl"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/org/repo.git"
            />
          </div>
          <div className="field">
            <label htmlFor="penv">Env (.env)</label>
            <textarea id="penv" rows={4} value={envText} onChange={(e) => setEnvText(e.target.value)} />
          </div>
          <div className="form-actions btn-row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() =>
                void runOps(selected.runtime === 'php' ? 'deploy-php' : 'deploy', selected.id)
              }
            >
              {selected.runtime === 'php' ? 'Deploy PHP' : t('projects.deploy')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void runOps('git-deploy', selected.id)}
            >
              Git deploy
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void runOps('env', selected.id)}
            >
              Save env
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void runOps('backup', selected.id)}
            >
              Backup
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void runOps('publish-nginx', selected.id)}
            >
              {t('projects.publishNginx')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void runOps('health', selected.id)}
            >
              {t('projects.health')}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={() => void runOps('stop', selected.id)}
            >
              {t('projects.stop')}
            </button>
          </div>
          <div className="form-actions btn-row">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const r = await projectsApi.logs(selected.id);
                    if (r.files[0]) {
                      const t = await projectsApi.logs(selected.id, r.files[0].name, 80);
                      setLogTail(
                        `# ${t.tail?.file ?? r.files[0].name}\n` + (t.tail?.lines ?? []).join('\n'),
                      );
                    } else {
                      setLogTail('(no log files yet — deploy first)');
                    }
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'logs failed');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              View logs
            </button>
            <label className="muted u-text-sm" htmlFor="qmb">
              Quota MiB
            </label>
            <input
              id="qmb"
              value={quotaMb}
              onChange={(e) => setQuotaMb(e.target.value)}
              title="Quota MiB"
            />
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const r = await projectsApi.setQuota(selected.id, Number(quotaMb) || 1024);
                    setOpsLog(r);
                    setMsg('Quota updated');
                    await refreshAndSelect();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'quota failed');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Set quota
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const r = await projectsApi.publishNginx(selected.id, { ssl: true });
                    setOpsLog(r);
                    setMsg(r.ok ? 'Nginx SSL publish OK' : 'Nginx SSL publish issues');
                    await refreshAndSelect();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'ssl publish failed');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Publish Nginx+SSL
            </button>
            <label className="muted u-text-sm" htmlFor="mem">
              MemoryMax
            </label>
            <input id="mem" value={memoryMax} onChange={(e) => setMemoryMax(e.target.value)} />
            <label className="muted u-text-sm" htmlFor="cpuq">
              CPU%
            </label>
            <input id="cpuq" value={cpuQuota} onChange={(e) => setCpuQuota(e.target.value)} />
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const r = await projectsApi.setResources(selected.id, {
                      memoryMax,
                      cpuQuotaPercent: Number(cpuQuota) || 100,
                    });
                    setOpsLog(r);
                    setMsg('Resources saved — redeploy to apply unit');
                    await refreshAndSelect();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'resources failed');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Set resources
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const r = await projectsApi.wordpressDownload(selected.id);
                    setOpsLog(r as unknown as OpsApplyResultDto);
                    setMsg(
                      r.ok
                        ? 'WordPress core ready'
                        : String((r.notes as string[] | undefined)?.slice(-1)[0] ?? 'WP download needs YSK_EXECUTE'),
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'wp download failed');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Download WordPress
            </button>
          </div>
          {logTail && (
            <div className="u-mt-4">
              <h3 className="section-title">Logs</h3>
              <pre className="code code--spaced">{logTail}</pre>
            </div>
          )}
          {opsLog && (
            <div className="u-mt-4">
              <h3 className="section-title">{t('projects.opsResult')}</h3>
              <pre className="code code--spaced">{JSON.stringify(opsLog, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
