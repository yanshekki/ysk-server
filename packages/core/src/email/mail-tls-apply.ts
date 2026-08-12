/**
 * Bind Let's Encrypt (or existing) cert paths into Postfix/Dovecot for mail hostnames.
 * Does not run certbot — only applies paths when files already exist (D7 polish).
 */

import { tl } from '@yanshekki/shared';
import type { HostExecutor } from '../host/executor.js';
import { panelBlockMessage } from '../hosting/system-apply.js';

export type MailTlsApplyResult = {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  certBase?: string;
  mailHost: string;
  applied: boolean;
  steps: Array<{ name: string; status: 'ok' | 'skipped' | 'failed'; detail?: string }>;
};

function certLiveBase(mailHost: string): string {
  return `/etc/letsencrypt/live/${mailHost}`;
}

function certFilesPresent(host: HostExecutor, base: string): boolean {
  try {
    return host.pathExists(`${base}/fullchain.pem`) && host.pathExists(`${base}/privkey.pem`);
  } catch {
    return false;
  }
}

/**
 * Apply TLS paths for mail.<domain> (default) or explicit hostname.
 */
export async function applyMailTlsPaths(input: {
  host: HostExecutor;
  domain: string;
  /** Defaults to mail.<domain> */
  mailHost?: string;
  /** Also set Dovecot ssl_cert/ssl_key via doveconf if possible */
  applyDovecot?: boolean;
}): Promise<MailTlsApplyResult> {
  const domain = input.domain.trim().toLowerCase();
  const mailHost = (input.mailHost ?? `mail.${domain}`).trim().toLowerCase();
  const notes: string[] = [];
  const steps: MailTlsApplyResult['steps'] = [];

  if (!domain) {
    return {
      ok: false,
      mailHost,
      applied: false,
      notes: [tl('notes.needDomain')],
      steps: [],
    };
  }

  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    const reason = !input.host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(reason);
    return {
      ok: false,
      blocked: true,
      blockMessage,
      mailHost,
      applied: false,
      notes: [blockMessage, tl('email.mailTls.needRootExecute')],
      steps: [],
    };
  }

  const certBase = certLiveBase(mailHost);
  if (!certFilesPresent(input.host, certBase)) {
    notes.push(tl('email.mailTls.certMissing', { host: mailHost, path: certBase }));
    notes.push(tl('email.mailTls.getCertFirst', { host: mailHost }));
    steps.push({
      name: 'cert-files',
      status: 'failed',
      detail: certBase,
    });
    return {
      ok: false,
      mailHost,
      certBase,
      applied: false,
      notes,
      steps,
    };
  }

  steps.push({ name: 'cert-files', status: 'ok', detail: certBase });
  notes.push(tl('email.mailTls.certFound', { host: mailHost }));

  const fullchain = `${certBase}/fullchain.pem`;
  const privkey = `${certBase}/privkey.pem`;

  const conf = await input.host.runCommand(
    [
      'bash',
      '-c',
      [
        `postconf -e "smtpd_tls_cert_file = ${fullchain}"`,
        `postconf -e "smtpd_tls_key_file = ${privkey}"`,
        'postconf -e "smtpd_tls_security_level = may"',
        'postconf -e "smtp_tls_security_level = may"',
      ].join(' && '),
    ],
    { timeoutMs: 20_000 },
  );
  if (conf.exitCode !== 0) {
    notes.push(tl('email.mailTls.postconfFailed', { detail: conf.stderr || conf.stdout }));
    steps.push({ name: 'postfix-postconf', status: 'failed', detail: conf.stderr });
    return { ok: false, mailHost, certBase, applied: false, notes, steps };
  }
  steps.push({ name: 'postfix-postconf', status: 'ok' });
  notes.push(tl('email.mailTls.postfixPathsSet'));

  const rel = await input.host.runCommand(
    ['bash', '-c', 'systemctl reload postfix 2>&1 || service postfix reload 2>&1'],
    { timeoutMs: 30_000 },
  );
  if (rel.exitCode === 0) {
    steps.push({ name: 'postfix-reload', status: 'ok' });
    notes.push(tl('email.mailTls.postfixReloaded'));
  } else {
    steps.push({
      name: 'postfix-reload',
      status: 'failed',
      detail: rel.stderr || rel.stdout,
    });
    notes.push(tl('email.mailTls.postfixReloadFailed', { detail: (rel.stderr || rel.stdout).slice(0, 200) }));
  }

  if (input.applyDovecot !== false) {
    // Best-effort: write snippet for operator / conf.d if doveconf available
    const dove = await input.host.runCommand(
      [
        'bash',
        '-c',
        [
          'if command -v doveconf >/dev/null 2>&1; then',
          `  printf 'ssl = required\\nssl_cert = <%s\\nssl_key = <%s\\n' ${JSON.stringify(fullchain)} ${JSON.stringify(privkey)} > /etc/dovecot/conf.d/99-ysk-mail-tls.conf`,
          '  systemctl reload dovecot 2>/dev/null || service dovecot reload 2>/dev/null || true',
          '  echo dove_ok',
          'else',
          '  echo dove_skip',
          'fi',
        ].join('\n'),
      ],
      { timeoutMs: 20_000 },
    );
    if ((dove.stdout || '').includes('dove_ok')) {
      steps.push({ name: 'dovecot-tls', status: 'ok' });
      notes.push(tl('email.mailTls.dovecotApplied'));
    } else {
      steps.push({ name: 'dovecot-tls', status: 'skipped' });
      notes.push(tl('email.mailTls.dovecotSkipped'));
    }
  }

  const applied = steps.some((s) => s.name === 'postfix-postconf' && s.status === 'ok');
  return {
    ok: applied && steps.find((s) => s.name === 'postfix-reload')?.status === 'ok',
    mailHost,
    certBase,
    applied,
    notes,
    steps,
  };
}
