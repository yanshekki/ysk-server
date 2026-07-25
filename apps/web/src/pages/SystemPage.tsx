import { FormEvent, useEffect, useState } from 'react';
import { api } from '../shared/services/api';

export function SystemPage() {
  const [domain, setDomain] = useState('demo.local');
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [certs, setCerts] = useState<Array<Record<string, unknown>>>([]);
  const [fullchain, setFullchain] = useState(
    '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
  );
  const [privkey, setPrivkey] = useState(
    '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n',
  );
  const [serverIp, setServerIp] = useState('203.0.113.10');
  const [cfToken, setCfToken] = useState('');

  async function refreshCerts() {
    try {
      const r = await api.listSslCertificates();
      setCerts(r.items);
    } catch {
      /* optional until login */
    }
  }

  useEffect(() => {
    void refreshCerts();
  }, []);

  async function run(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestRaw<unknown>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setLog(JSON.stringify(r, null, 2));
      if (path.includes('/ssl/')) await refreshCerts();
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
          <h2 className="card__title">FTPS (vsftpd)</h2>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              void run('/api/v1/system/ftps/apply', { domain, install: false })
            }
          >
            Write FTPS config
          </button>
        </div>
        <div className="card">
          <h2 className="card__title">Cloudflare DNS</h2>
          <div className="field field--flush">
            <label htmlFor="sip">Server IP</label>
            <input id="sip" value={serverIp} onChange={(e) => setServerIp(e.target.value)} />
          </div>
          <div className="field field--flush">
            <label htmlFor="cft">API Token (optional)</label>
            <input
              id="cft"
              type="password"
              value={cfToken}
              onChange={(e) => setCfToken(e.target.value)}
              placeholder="or CF_API_TOKEN env"
            />
          </div>
          <div className="form-actions btn-row">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() =>
                void run('/api/v1/hosting/dns/plan', { zone: domain, serverIp })
              }
            >
              Plan zone
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() =>
                void run('/api/v1/hosting/dns/cloudflare/apply', {
                  zone: domain,
                  serverIp,
                  token: cfToken || undefined,
                  dryRun: !cfToken,
                })
              }
            >
              Apply (dry-run if no token)
            </button>
          </div>
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
          <h2 className="card__title">fail2ban</h2>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() => void run('/api/v1/system/fail2ban/apply', { apply: false })}
          >
            Write jail.local
          </button>
        </div>
        <div className="card">
          <h2 className="card__title">PostgreSQL provision</h2>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              void run('/api/v1/hosting/db/postgres-provision', {
                dbName: 'yskapp',
                username: 'yskapp',
                password: 'changeme99',
                execute: false,
              })
            }
          >
            Plan / probe PG (execute=false)
          </button>
        </div>
        <div className="card">
          <h2 className="card__title">Redis provision</h2>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              void run('/api/v1/hosting/db/redis-provision', {
                projectId: 'demo',
                dbIndex: 1,
                execute: false,
              })
            }
          >
            Probe Redis
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

      <div className="card">
        <h2 className="card__title">Upload SSL certificate (PEM)</h2>
        <p className="card__desc">Stored under dataDir/certs/&lt;domain&gt;/ — use with Publish Nginx ssl</p>
        <div className="field">
          <label htmlFor="fullchain">fullchain.pem</label>
          <textarea
            id="fullchain"
            rows={4}
            value={fullchain}
            onChange={(e) => setFullchain(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="privkey">privkey.pem</label>
          <textarea
            id="privkey"
            rows={4}
            value={privkey}
            onChange={(e) => setPrivkey(e.target.value)}
          />
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() =>
              void run('/api/v1/ssl/upload', {
                domain,
                fullchainPem: fullchain,
                privkeyPem: privkey,
              })
            }
          >
            Upload cert
          </button>
        </div>
      </div>

      {certs.length > 0 && (
        <div className="card">
          <h2 className="card__title">SSL apply 紀錄（write-back）</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {certs.slice(0, 10).map((c) => (
                  <tr key={String(c.id)}>
                    <td>{String(c.domain ?? '—')}</td>
                    <td>
                      <span className="badge badge--ok">{String(c.apply_status ?? '—')}</span>
                    </td>
                    <td className="muted">{String(c.updated_at ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {log && (
        <div className="card">
          <h2 className="card__title">Result</h2>
          <pre className="code">{log}</pre>
        </div>
      )}
    </div>
  );
}
