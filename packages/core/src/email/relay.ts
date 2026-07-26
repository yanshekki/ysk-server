/**
 * SMTP relay configuration for when Port 25 is blocked (Spec §5.4 C).
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import type { YskDatabase } from '../db/database.js';

export interface SmtpRelayConfig {
  host: string;
  port: number;
  username?: string;
  /** Never store raw password in plain logs; optional sasl password file path */
  password?: string;
  security: 'none' | 'starttls' | 'tls';
  domain?: string;
}

export interface SmtpRelayApplyResult {
  ok: boolean;
  written: string[];
  notes: string[];
  requiresExecute: boolean;
  requiresRoot: boolean;
  appliedToSystem: boolean;
  config: Omit<SmtpRelayConfig, 'password'> & { passwordSet: boolean };
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
}

/**
 * Write Postfix relay maps under dataDir/email/relay/.
 * Optionally copy to /etc/postfix when EXECUTE+root.
 */
export async function applySmtpRelay(input: {
  dataDir: string;
  host: HostExecutor;
  relay: SmtpRelayConfig;
  /** Attempt system install of relay snippets */
  applySystem?: boolean;
  db?: YskDatabase;
  actor?: string;
}): Promise<SmtpRelayApplyResult> {
  const r = input.relay;
  if (!r.host?.trim()) {
    throw new YskError(ErrorCodes.VALIDATION, 'relay.host required', { httpStatus: 400 });
  }
  if (!Number.isInteger(r.port) || r.port < 1 || r.port > 65535) {
    throw new YskError(ErrorCodes.VALIDATION, 'relay.port invalid', { httpStatus: 400 });
  }
  const dir = join(input.dataDir, 'email', 'relay');
  mkdirSync(dir, { recursive: true });

  const security = r.security ?? 'starttls';
  const mainSnippet = [
    '# YSK Server — SMTP relay snippet (include / append to main.cf)',
    `relayhost = [${r.host}]:${r.port}`,
    'smtp_sasl_auth_enable = yes',
    'smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd',
    'smtp_sasl_security_options = noanonymous',
    security === 'tls'
      ? 'smtp_tls_security_level = encrypt'
      : security === 'starttls'
        ? 'smtp_tls_security_level = may'
        : 'smtp_tls_security_level = none',
    'smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt',
    '',
  ].join('\n');

  const user = r.username ?? '';
  const pass = r.password ?? 'CHANGE_ME';
  const saslLine = `[${r.host}]:${r.port} ${user}:${pass}\n`;

  const snippetPath = join(dir, 'relay-main.cf.snippet');
  const saslPath = join(dir, 'sasl_passwd');
  const readme = join(dir, 'README.txt');
  writeFileSync(snippetPath, mainSnippet, 'utf8');
  writeFileSync(saslPath, saslLine, { mode: 0o600 });
  writeFileSync(
    readme,
    [
      'SMTP relay for blocked Port 25',
      `Host: ${r.host}:${r.port}`,
      '1. Merge relay-main.cf.snippet into /etc/postfix/main.cf',
      '2. Install sasl_passwd → postmap hash:/etc/postfix/sasl_passwd',
      '3. systemctl reload postfix',
      'Credentials file mode should be 600.',
      '',
    ].join('\n'),
    'utf8',
  );

  const notes = [
    `Wrote relay snippets under ${dir}`,
    r.password ? 'Password written to managed sasl_passwd (restrict access)' : 'Password placeholder CHANGE_ME',
  ];
  const written = [snippetPath, saslPath, readme];
  const commandResults: SmtpRelayApplyResult['commandResults'] = [];
  let appliedToSystem = false;

  const want = Boolean(input.applySystem);
  const can = want && input.host.executeEnabled() && input.host.isRoot();
  if (want && !can) {
    notes.push('無法套用系統中繼設定：需要系統變更權限');
  }
  if (can) {
    const steps: string[][] = [
      ['cp', snippetPath, '/etc/postfix/ysk-relay.cf'],
      ['cp', saslPath, '/etc/postfix/sasl_passwd'],
      ['chmod', '600', '/etc/postfix/sasl_passwd'],
      ['postmap', 'hash:/etc/postfix/sasl_passwd'],
      [
        'bash',
        '-c',
        'grep -q ysk-relay.cf /etc/postfix/main.cf || echo "include /etc/postfix/ysk-relay.cf" >> /etc/postfix/main.cf',
      ],
      ['systemctl', 'reload', 'postfix'],
    ];
    for (const argv of steps) {
      const res = await input.host.runCommand(argv, { timeoutMs: 30_000 });
      commandResults.push({ argv, exitCode: res.exitCode, stderr: res.stderr });
    }
    appliedToSystem = commandResults.every((c) => c.exitCode === 0);
    notes.push(appliedToSystem ? 'Relay applied to system Postfix' : 'Some system steps failed');
  }

  const publicConfig = {
    host: r.host,
    port: r.port,
    username: r.username,
    security,
    domain: r.domain,
    passwordSet: Boolean(r.password),
  };

  if (input.db) {
    input.db.snapshot.settings['email.smtp_relay'] = JSON.stringify({
      ...publicConfig,
      updated_at: new Date().toISOString(),
      actor: input.actor,
      paths: written,
    });
    input.db.persist();
  }

  return {
    ok: want ? can && appliedToSystem : true,
    written,
    notes,
    requiresExecute: !input.host.executeEnabled(),
    requiresRoot: !input.host.isRoot(),
    appliedToSystem,
    config: publicConfig,
    commandResults,
  };
}

export function loadSmtpRelaySettings(dataDir: string): Record<string, unknown> | null {
  const p = join(dataDir, 'email', 'relay', 'relay-main.cf.snippet');
  if (!existsSync(p)) return null;
  return {
    snippetPath: p,
    snippetPreview: readFileSync(p, 'utf8').slice(0, 400),
  };
}
