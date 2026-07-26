import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { emailApi, useEmailDomains, type EmailBundle } from '../features/email';

export function EmailPage() {
  const { t } = useTranslation();
  const { items, error, setError, busy, setBusy, create, loadDns } = useEmailDomains();
  const [domain, setDomain] = useState('');
  const [serverIp, setServerIp] = useState('203.0.113.10');
  const [bundle, setBundle] = useState<EmailBundle | null>(null);
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [dnsbl, setDnsbl] = useState<Record<string, unknown> | null>(null);
  const [warmup, setWarmup] = useState<Record<string, unknown> | null>(null);
  const [dnsblLast, setDnsblLast] = useState<Record<string, unknown> | null>(null);
  const [relayHost, setRelayHost] = useState('smtp.example.com');
  const [relayUser, setRelayUser] = useState('');
  const [relayPass, setRelayPass] = useState('');
  const [relayLog, setRelayLog] = useState<Record<string, unknown> | null>(null);
  const [mboxLocal, setMboxLocal] = useState('info');
  const [mboxPass, setMboxPass] = useState('');
  const [mboxLog, setMboxLog] = useState<Record<string, unknown> | null>(null);
  const [mailboxes, setMailboxes] = useState<Array<Record<string, unknown>>>([]);
  const [webmailDomain, setWebmailDomain] = useState('webmail.example.com');
  const [webmailLog, setWebmailLog] = useState<Record<string, unknown> | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await create({ domain, serverIp });
      setBundle({
        records: created.records,
        externalTodos: created.externalTodos,
        health: created.health,
      });
      setDomain('');
    } catch {
      /* hook sets error */
    }
  }

  async function onDns(id: string) {
    try {
      setBundle(await loadDns(id));
    } catch {
      /* */
    }
  }

  async function runLiveCheck(id: string) {
    setBusy(true);
    setError(null);
    try {
      setLive(await emailApi.liveCheck(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'live-check failed');
    } finally {
      setBusy(false);
    }
  }

  async function runDnsbl(ip: string) {
    setBusy(true);
    setError(null);
    try {
      setDnsbl(await emailApi.dnsbl(ip));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'dnsbl failed');
    } finally {
      setBusy(false);
    }
  }

  async function runWarmup(id: string) {
    setBusy(true);
    setError(null);
    try {
      setWarmup(await emailApi.warmupDomain(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'warmup failed');
    } finally {
      setBusy(false);
    }
  }

  async function loadDnsblSchedule() {
    try {
      const r = await emailApi.dnsblLast();
      setDnsblLast(r.last);
    } catch {
      /* optional */
    }
  }

  return (
    <div>
      <header className="page-header">
        <h1>{t('email.title')}</h1>
        <p>{t('email.externalTodos')}</p>
      </header>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="card">
        <h2 className="card__title">{t('email.create')}</h2>
        <form onSubmit={(e) => void onCreate(e)}>
          <div className="grid">
            <div className="field field--flush">
              <label htmlFor="edomain">Domain</label>
              <input
                id="edomain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                required
              />
            </div>
            <div className="field field--flush">
              <label htmlFor="eip">Server IP</label>
              <input id="eip" value={serverIp} onChange={(e) => setServerIp(e.target.value)} required />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t('email.create')}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="card__title">Mailbox (Maildir)</h2>
        <p className="card__desc">
          Writes Maildir + virtual_mailbox map under dataDir/email/&lt;domain&gt;/ — system user needs
          root + YSK_EXECUTE
        </p>
        <div className="grid">
          <div className="field field--flush">
            <label htmlFor="mlocal">Local part</label>
            <input id="mlocal" value={mboxLocal} onChange={(e) => setMboxLocal(e.target.value)} />
          </div>
          <div className="field field--flush">
            <label htmlFor="mpass">Password (optional, ≥8)</label>
            <input
              id="mpass"
              type="password"
              value={mboxPass}
              onChange={(e) => setMboxPass(e.target.value)}
            />
          </div>
        </div>
        <div className="form-actions btn-row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || items.length === 0}
            onClick={() => {
              void (async () => {
                const id = items[0]?.id;
                if (!id) return;
                setBusy(true);
                setError(null);
                try {
                  setMboxLog(
                    await emailApi.createMailbox(id, {
                      localPart: mboxLocal,
                      password: mboxPass || undefined,
                    }),
                  );
                  const list = await emailApi.listMailboxes(id);
                  setMailboxes(list.items);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'mailbox failed');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Create on first domain
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy || items.length === 0}
            onClick={() => {
              void (async () => {
                if (!items[0]?.id) return;
                setMailboxes((await emailApi.listMailboxes(items[0].id)).items);
              })();
            }}
          >
            Refresh list
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy || items.length === 0}
            onClick={() => {
              void (async () => {
                if (!items[0]?.id) return;
                setBusy(true);
                try {
                  setMboxLog(await emailApi.dovecotPassdb(items[0].id));
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'passdb failed');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Write Dovecot passdb
          </button>
        </div>
        {mailboxes.length > 0 && (
          <ul className="list-plain list-spaced u-mt-4">
            {mailboxes.map((m) => (
              <li key={String(m.id)}>
                <code className="inline">{String(m.address)}</code>{' '}
                <span className="badge">{String(m.status)}</span>
              </li>
            ))}
          </ul>
        )}
        {mboxLog && <pre className="code code--spaced">{JSON.stringify(mboxLog, null, 2)}</pre>}
      </div>

      <div className="card">
        <h2 className="card__title">一鍵 Email Bootstrap（Spec §5）</h2>
        <p className="card__desc">
          DKIM 域名 + MTA 配置 + postmaster 信箱 + passdb + webmail 計劃。系統 apt 需 root+YSK_EXECUTE；DNS/PTR/Port25
          仍係外部待辦。
        </p>
        <div className="form-actions btn-row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !domain || !serverIp}
            onClick={() => {
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  setWebmailLog(
                    await emailApi.bootstrap({
                      domain,
                      serverIp,
                      adminLocalPart: 'postmaster',
                      adminPassword: 'ChangeMe99!',
                      installPackages: false,
                      webmail: true,
                    }),
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'bootstrap failed');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Bootstrap（計劃模式）
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">Webmail (Roundcube)</h2>
        <p className="card__desc">
          Writes config + nginx under dataDir; download needs YSK_EXECUTE (never fake success)
        </p>
        <div className="field">
          <label htmlFor="wmd">Webmail hostname</label>
          <input
            id="wmd"
            value={webmailDomain}
            onChange={(e) => setWebmailDomain(e.target.value)}
          />
        </div>
        <div className="form-actions btn-row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  setWebmailLog(
                    await emailApi.webmailApply({ domain: webmailDomain, download: false }),
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'webmail failed');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Write plan
          </button>
        </div>
        {webmailLog && (
          <pre className="code code--spaced">{JSON.stringify(webmailLog, null, 2)}</pre>
        )}
      </div>

      <div className="card">
        <h2 className="card__title">SMTP relay (Port 25 blocked)</h2>
        <p className="card__desc">Writes Postfix relay snippets under dataDir; system apply needs root + YSK_EXECUTE</p>
        <div className="grid">
          <div className="field field--flush">
            <label htmlFor="rh">Relay host</label>
            <input id="rh" value={relayHost} onChange={(e) => setRelayHost(e.target.value)} />
          </div>
          <div className="field field--flush">
            <label htmlFor="ru">Username</label>
            <input id="ru" value={relayUser} onChange={(e) => setRelayUser(e.target.value)} />
          </div>
          <div className="field field--flush">
            <label htmlFor="rp">Password</label>
            <input
              id="rp"
              type="password"
              value={relayPass}
              onChange={(e) => setRelayPass(e.target.value)}
            />
          </div>
        </div>
        <div className="form-actions btn-row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  setRelayLog(
                    await emailApi.setRelay({
                      host: relayHost,
                      port: 587,
                      username: relayUser || undefined,
                      password: relayPass || undefined,
                      security: 'starttls',
                      applySystem: false,
                    }),
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'relay failed');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Save relay config
          </button>
        </div>
        {relayLog && <pre className="code code--spaced">{JSON.stringify(relayLog, null, 2)}</pre>}
      </div>

      <div className="card">
        <h2 className="card__title">{t('email.domains')}</h2>
        <div className="form-actions btn-row">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void loadDnsblSchedule()}>
            Last scheduled DNSBL
          </button>
        </div>
        {items.length === 0 ? (
          <div className="empty">
            <div className="empty__title">—</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Health</th>
                  <th>Apply</th>
                  <th>IP</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.domain}</strong>
                    </td>
                    <td>
                      <span className={`badge${d.health_score >= 80 ? ' badge--ok' : ' badge--warn'}`}>
                        {d.health_score}/100
                      </span>
                    </td>
                    <td>
                      <span className="badge">{d.apply_status ?? '—'}</span>
                    </td>
                    <td className="muted">{d.server_ip}</td>
                    <td>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() => void onDns(d.id)}
                        >
                          DNS
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() => void runLiveCheck(d.id)}
                        >
                          Live check
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() => void runDnsbl(d.server_ip)}
                        >
                          DNSBL
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() => void runWarmup(d.id)}
                        >
                          Warm-up
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

      {dnsblLast && (
        <div className="card">
          <h2 className="card__title">Scheduled DNSBL (last run)</h2>
          <pre className="code">{JSON.stringify(dnsblLast, null, 2)}</pre>
        </div>
      )}
      {warmup && (
        <div className="card">
          <h2 className="card__title">Warm-up plan</h2>
          <pre className="code">{JSON.stringify(warmup, null, 2)}</pre>
        </div>
      )}
      {live && (
        <div className="card">
          <h2 className="card__title">Live check result</h2>
          <pre className="code">{JSON.stringify(live, null, 2)}</pre>
        </div>
      )}
      {dnsbl && (
        <div className="card">
          <h2 className="card__title">DNSBL / blacklist</h2>
          <p>
            {dnsbl.ok ? (
              <span className="badge badge--ok">clean</span>
            ) : (
              <span className="badge badge--danger">listed</span>
            )}{' '}
            <span className="muted">{String(dnsbl.ip)}</span>
          </p>
          <pre className="code">{JSON.stringify(dnsbl, null, 2)}</pre>
        </div>
      )}
      {bundle && (
        <div className="card">
          <h2 className="card__title">
            Health {bundle.health.score}/{bundle.health.maxScore}
          </h2>
          {bundle.health.messages.length > 0 && (
            <ul className="muted list-flush">
              {bundle.health.messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <h3 className="section-title">DNS records</h3>
          <div className="table-wrap u-mb-4">
            <table className="data">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {bundle.records.map((r, i) => (
                  <tr key={`${r.type}-${r.name}-${i}`}>
                    <td>
                      <span className="badge">{r.type}</span>
                    </td>
                    <td>{r.name}</td>
                    <td>
                      <code className="inline u-break-all">{r.value}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="section-title">{t('email.externalTodos')}</h3>
          <ul className="list-plain list-spaced">
            {bundle.externalTodos.map((todo) => (
              <li key={todo.id}>
                <strong>{todo.title}</strong>
                <div className="muted">{todo.description}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
