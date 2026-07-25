/**
 * System-level apply orchestrators: write configs under dataDir, optionally install/copy with YSK_EXECUTE.
 */

import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { planEmailStackInstall } from '../email/dns-records.js';
import { planLetsEncrypt, renderNginxProxy } from './nginx-ssl.js';
import { renderPhpVhost, selectPhpRuntime } from './runtime.js';
import { planFtps, planFirewall } from './extras.js';
import { ErrorCodes, YskError } from '@ysk/shared';

export interface ApplyResult {
  ok: boolean;
  written: string[];
  commands: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  notes: string[];
}

async function runAll(
  host: HostExecutor,
  commands: string[][],
  execute: boolean,
): Promise<ApplyResult['commandResults']> {
  const out: ApplyResult['commandResults'] = [];
  if (!execute) return out;
  for (const argv of commands) {
    const r = await host.runCommand(argv, { timeoutMs: 180_000 });
    out.push({ argv, exitCode: r.exitCode, stderr: r.stderr });
  }
  return out;
}

/**
 * Write Postfix/Dovecot/OpenDKIM skeleton configs; optionally apt-install when root+EXECUTE.
 */
export async function applyEmailStack(input: {
  dataDir: string;
  domain: string;
  mailHostname?: string;
  host: HostExecutor;
  installPackages?: boolean;
}): Promise<ApplyResult & { serviceStatus?: Record<string, string> }> {
  const domain = input.domain.trim().toLowerCase();
  if (!domain) throw new YskError(ErrorCodes.VALIDATION, 'domain required', { httpStatus: 400 });
  const mailHost = input.mailHostname ?? `mail.${domain}`;
  const dir = join(input.dataDir, 'email', domain);
  mkdirSync(join(dir, 'postfix'), { recursive: true });
  mkdirSync(join(dir, 'dovecot'), { recursive: true });
  mkdirSync(join(dir, 'opendkim'), { recursive: true });

  const mainCf = [
    `myhostname = ${mailHost}`,
    `myorigin = ${domain}`,
    'inet_interfaces = all',
    'inet_protocols = ipv4',
    'smtpd_banner = $myhostname ESMTP YSK',
    'smtpd_tls_security_level = may',
    'smtpd_tls_cert_file = /etc/letsencrypt/live/' + mailHost + '/fullchain.pem',
    'smtpd_tls_key_file = /etc/letsencrypt/live/' + mailHost + '/privkey.pem',
    'smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, defer_unauth_destination',
    'mynetworks = 127.0.0.0/8',
    '',
  ].join('\n');
  const dovecot = [
    'protocols = imap pop3 lmtp',
    'mail_location = maildir:~/Maildir',
    'ssl = required',
    `ssl_cert = </etc/letsencrypt/live/${mailHost}/fullchain.pem`,
    `ssl_key = </etc/letsencrypt/live/${mailHost}/privkey.pem`,
    '',
  ].join('\n');
  const opendkim = [
    'Syslog yes',
    'Mode sv',
    'Canonicalization relaxed/simple',
    `Domain ${domain}`,
    'Selector default',
    `KeyFile ${dir}/opendkim/default.private`,
    'Socket inet:8891@localhost',
    '',
  ].join('\n');

  const written = [
    join(dir, 'postfix', 'main.cf'),
    join(dir, 'dovecot', 'dovecot.conf'),
    join(dir, 'opendkim', 'opendkim.conf'),
    join(dir, 'README.txt'),
  ];
  writeFileSync(written[0], mainCf, 'utf8');
  writeFileSync(written[1], dovecot, 'utf8');
  writeFileSync(written[2], opendkim, 'utf8');
  writeFileSync(
    written[3],
    `YSK Server managed mail configs for ${domain}\nCopy to /etc when ready (root + YSK_EXECUTE=1).\n`,
    'utf8',
  );

  const plan = planEmailStackInstall(domain);
  const notes = [...plan.notes, `Configs under ${dir}`];
  const commands: string[][] = [];
  if (input.installPackages) {
    commands.push(['apt-get', 'update']);
    commands.push(['bash', '-c', `DEBIAN_FRONTEND=noninteractive apt-get install -y ${plan.packages.join(' ')}`]);
    commands.push(['cp', written[0], '/etc/postfix/main.cf']);
    commands.push(['systemctl', 'reload', 'postfix']);
  }

  const execute = Boolean(input.installPackages && input.host.executeEnabled() && input.host.isRoot());
  if (input.installPackages && !execute) {
    notes.push('Package install skipped: need root + YSK_EXECUTE=1');
  }
  const commandResults = await runAll(input.host, commands, execute);
  const ok = commandResults.every((c) => c.exitCode === 0) || !execute;
  const serviceStatus: Record<string, string> = {};
  for (const svc of ['postfix', 'dovecot', 'opendkim']) {
    try {
      const st = await input.host.runCommand(['systemctl', 'is-active', svc], { timeoutMs: 5_000 });
      serviceStatus[svc] = (st.stdout || st.stderr || `exit_${st.exitCode}`).trim();
    } catch {
      serviceStatus[svc] = 'unknown';
    }
  }
  notes.push(`services: ${JSON.stringify(serviceStatus)}`);
  return {
    ok,
    written,
    commands: commands.map((a) => a.join(' ')),
    commandResults,
    notes,
    serviceStatus,
  };
}

/**
 * Certbot plan + optional run for a domain.
 */
export async function applyLetsEncrypt(input: {
  domain: string;
  email: string;
  host: HostExecutor;
  run?: boolean;
}): Promise<ApplyResult> {
  const plan = planLetsEncrypt({
    domain: input.domain,
    email: input.email,
    provider: 'letsencrypt',
    challenge: 'http-01',
  });
  const notes = [...plan.notes];
  const commands = plan.commands.map((c) => ['bash', '-c', c]);
  const execute = Boolean(input.run && input.host.executeEnabled() && input.host.isRoot());
  if (input.run && !execute) notes.push('certbot run skipped: need root + YSK_EXECUTE=1');
  const commandResults = await runAll(input.host, commands, execute);
  return {
    ok: execute ? commandResults.every((c) => c.exitCode === 0) : true,
    written: [],
    commands: plan.commands,
    commandResults,
    notes,
  };
}

/**
 * Write PHP vhost under dataDir; optional copy to Apache sites-available.
 */
export async function applyPhpHosting(input: {
  dataDir: string;
  domain: string;
  docRoot: string;
  phpVersion: string;
  poolName: string;
  host: HostExecutor;
  enableSite?: boolean;
}): Promise<ApplyResult> {
  const rt = selectPhpRuntime(input.phpVersion);
  const dir = join(input.dataDir, 'apache', 'sites');
  mkdirSync(dir, { recursive: true });
  mkdirSync(input.docRoot, { recursive: true });
  const conf = renderPhpVhost({
    domain: input.domain,
    docRoot: input.docRoot,
    phpVersion: rt.version,
    poolName: input.poolName,
  });
  const path = join(dir, `${input.poolName}.conf`);
  writeFileSync(path, conf, 'utf8');
  const index = join(input.docRoot, 'index.php');
  if (!existsSync(index)) {
    writeFileSync(index, '<?php echo "YSK PHP OK\\n";\n', 'utf8');
  }
  const notes = [`PHP ${rt.version} vhost at ${path}`, `binary ${rt.binaryPath}`];
  const commands: string[][] = [];
  if (input.enableSite) {
    commands.push(['cp', path, `/etc/apache2/sites-available/${input.poolName}.conf`]);
    commands.push(['a2ensite', input.poolName]);
    commands.push(['systemctl', 'reload', 'apache2']);
  }
  const execute = Boolean(input.enableSite && input.host.executeEnabled() && input.host.isRoot());
  if (input.enableSite && !execute) notes.push('Apache enable skipped: need root + YSK_EXECUTE=1');
  const commandResults = await runAll(input.host, commands, execute);
  const ranOk = commandResults.every((c) => c.exitCode === 0);
  let phpActive: string | undefined;
  if (execute) {
    const st = await input.host.runCommand(['systemctl', 'is-active', `php${rt.version}-fpm`], {
      timeoutMs: 5_000,
    });
    phpActive = (st.stdout || st.stderr || '').trim();
    notes.push(`php-fpm is-active: ${phpActive}`);
  }
  return {
    ok: execute ? ranOk : true,
    written: [path, index],
    commands: commands.map((c) => c.join(' ')),
    commandResults,
    notes: phpActive ? [...notes, `php_fpm=${phpActive}`] : notes,
  };
}

/**
 * Write FTPS (vsftpd) snippet under dataDir; optional install.
 */
export async function applyFtps(input: {
  dataDir: string;
  domain: string;
  host: HostExecutor;
  install?: boolean;
}): Promise<ApplyResult> {
  const plan = planFtps({ domain: input.domain });
  const dir = join(input.dataDir, 'ftps');
  mkdirSync(dir, { recursive: true });
  const confPath = join(dir, 'vsftpd.conf');
  writeFileSync(confPath, plan.configSnippet + '\n', 'utf8');
  const notes = [`Config ${confPath}`, `PASV ${plan.pasvMin}-${plan.pasvMax}`];
  const commands: string[][] = input.install
    ? plan.commands.map((c) => ['bash', '-c', c])
    : [];
  if (input.install) {
    commands.push(['cp', confPath, '/etc/vsftpd.conf']);
  }
  const execute = Boolean(input.install && input.host.executeEnabled() && input.host.isRoot());
  if (input.install && !execute) notes.push('FTPS install skipped: need root + YSK_EXECUTE=1');
  const commandResults = await runAll(input.host, commands, execute);
  return {
    ok: true,
    written: [confPath],
    commands: commands.map((c) => c.join(' ')),
    commandResults,
    notes,
  };
}

/**
 * Apply firewall rules (ufw) when EXECUTE+root; always returns rule list.
 */
export async function applyFirewall(input: {
  host: HostExecutor;
  allowSmtp?: boolean;
  apply?: boolean;
}): Promise<ApplyResult> {
  const plan = planFirewall({ allowSmtp: input.allowSmtp });
  const notes = ['Rules generated by planFirewall'];
  const commands = plan.commands.map((c) => ['bash', '-c', c]);
  const execute = Boolean(input.apply && input.host.executeEnabled() && input.host.isRoot());
  if (input.apply && !execute) notes.push('Firewall apply skipped: need root + YSK_EXECUTE=1');
  const commandResults = await runAll(input.host, commands, execute);
  return {
    ok: execute ? commandResults.every((c) => c.exitCode === 0) : true,
    written: [],
    commands: plan.commands,
    commandResults,
    notes: [...notes, `fail2ban jails: ${plan.fail2banJails.join(', ')}`],
  };
}

/**
 * Write nginx proxy conf and optionally sync + reload.
 */
export async function applyNginxSite(input: {
  dataDir: string;
  serverName: string;
  upstream: string;
  ssl?: boolean;
  host: HostExecutor;
  reload?: boolean;
}): Promise<ApplyResult> {
  const conf = renderNginxProxy({
    serverName: input.serverName,
    upstream: input.upstream,
    ssl: Boolean(input.ssl),
    cloudflareRealIp: true,
  });
  const dir = join(input.dataDir, 'nginx', 'conf.d');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${input.serverName.replace(/[^a-z0-9.-]+/gi, '_')}.conf`);
  writeFileSync(path, conf, 'utf8');
  const notes = [`Wrote ${path}`];
  const commands: string[][] = [];
  if (input.reload) {
    commands.push(['nginx', '-t']);
    commands.push(['systemctl', 'reload', 'nginx']);
  }
  const execute = Boolean(input.reload && input.host.executeEnabled());
  if (input.reload && !input.host.executeEnabled()) {
    notes.push('nginx reload skipped: set YSK_EXECUTE=1');
  }
  const commandResults = await runAll(input.host, commands, execute);
  return {
    ok: true,
    written: [path],
    commands: commands.map((c) => c.join(' ')),
    commandResults,
    notes,
  };
}

/**
 * Install systemd unit for control plane from template.
 */
export function writeControlPlaneSystemdUnit(input: {
  dataDir: string;
  nodePath?: string;
  cliPath: string;
  user?: string;
}): { unitPath: string; content: string } {
  const dir = join(input.dataDir, 'systemd');
  mkdirSync(dir, { recursive: true });
  const unitPath = join(dir, 'ysk-server.service');
  const node = input.nodePath ?? process.execPath;
  const user = input.user ?? 'root';
  const content = `[Unit]
Description=YSK Server control plane
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${input.dataDir}
Environment=NODE_ENV=production
ExecStart=${node} ${input.cliPath} serve --config ${join(input.dataDir, 'config.json')}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
  writeFileSync(unitPath, content, 'utf8');
  return { unitPath, content };
}

export async function installControlPlaneSystemd(input: {
  dataDir: string;
  cliPath: string;
  host: HostExecutor;
  enable?: boolean;
}): Promise<ApplyResult> {
  const { unitPath } = writeControlPlaneSystemdUnit({
    dataDir: input.dataDir,
    cliPath: input.cliPath,
  });
  const notes = [`Unit template at ${unitPath}`];
  const commands: string[][] = [];
  if (input.enable) {
    commands.push(['cp', unitPath, '/etc/systemd/system/ysk-server.service']);
    commands.push(['systemctl', 'daemon-reload']);
    commands.push(['systemctl', 'enable', '--now', 'ysk-server']);
  }
  const execute = Boolean(input.enable && input.host.executeEnabled() && input.host.isRoot());
  if (input.enable && !execute) notes.push('systemd install skipped: need root + YSK_EXECUTE=1');
  const commandResults = await runAll(input.host, commands, execute);
  return {
    ok: true,
    written: [unitPath],
    commands: commands.map((c) => c.join(' ')),
    commandResults,
    notes,
  };
}

// silence unused import if any
void copyFileSync;
