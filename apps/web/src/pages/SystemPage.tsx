import { FormEvent, useState } from 'react';
import { api } from '../shared/services/api';

export function SystemPage() {
  const [domain, setDomain] = useState('demo.local');
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestRaw<unknown>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setLog(JSON.stringify(r, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  function onEmail(e: FormEvent) {
    e.preventDefault();
    void run('/api/v1/system/email/apply', { domain, installPackages: false });
  }

  return (
    <div>
      <header className="page-header">
        <h1>系統套用 Wizard</h1>
        <p>寫入 dataDir 配置；真 apt/ufw/certbot 需伺服器 YSK_EXECUTE=1 + root</p>
      </header>
      {error && <div className="alert alert--error">{error}</div>}

      <div className="card">
        <h2 className="card__title">Email stack</h2>
        <form onSubmit={onEmail}>
          <div className="field">
            <label htmlFor="dom">Domain</label>
            <input id="dom" value={domain} onChange={(e) => setDomain(e.target.value)} />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              產生 Postfix/Dovecot/OpenDKIM 配置
            </button>
          </div>
        </form>
      </div>

      <div className="grid">
        <div className="card">
          <h2 className="card__title">PHP site</h2>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              void run('/api/v1/system/php/apply', {
                domain: `php.${domain}`,
                poolName: 'demo',
                enableSite: false,
              })
            }
          >
            Apply PHP vhost
          </button>
        </div>
        <div className="card">
          <h2 className="card__title">Nginx site</h2>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              void run('/api/v1/system/nginx/site', {
                serverName: `app.${domain}`,
                upstream: 'http://127.0.0.1:3000',
                reload: false,
              })
            }
          >
            Write nginx conf
          </button>
        </div>
        <div className="card">
          <h2 className="card__title">SSL (certbot plan)</h2>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              void run('/api/v1/system/ssl/apply', {
                domain,
                email: `admin@${domain}`,
                run: false,
              })
            }
          >
            Plan Let&apos;s Encrypt
          </button>
        </div>
        <div className="card">
          <h2 className="card__title">Firewall plan</h2>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() => void run('/api/v1/system/firewall/apply', { allowSmtp: true, apply: false })}
          >
            Generate ufw rules
          </button>
        </div>
        <div className="card">
          <h2 className="card__title">Protection probe</h2>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void run('/api/v1/protection/probe', {})}
          >
            Run probe
          </button>
        </div>
        <div className="card">
          <h2 className="card__title">systemd unit</h2>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() => void run('/api/v1/system/systemd/install', { enable: false })}
          >
            Write unit template
          </button>
        </div>
      </div>

      {log && (
        <div className="card">
          <h2 className="card__title">Result</h2>
          <pre className="code">{log}</pre>
        </div>
      )}
    </div>
  );
}
