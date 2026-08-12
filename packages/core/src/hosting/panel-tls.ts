/**
 * Control-plane (panel) TLS — enable HTTPS on ysk-server listenPort.
 * Uses Let's Encrypt live paths or managed dataDir certs; config written to config.json.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { YskConfig } from '../config/schema.js';
import { mergePanelTlsConfig, parseConfig } from '../config/schema.js';
import type { HostExecutor } from '../host/executor.js';
import type { YskDatabase } from '../db/store.js';
import {
  parseCertExpiryFromPath,
  resolveBestCertPaths,
  resolveLetsEncryptLivePaths,
  upsertLetsEncryptRecord,
} from './ssl-certs.js';
import { panelBlockMessage } from './system-apply.js';
import { tl } from '@ysk-server/shared';

/** Bootstrap self-signed materials for first IP login (under dataDir). */
export function panelBootstrapTlsDir(dataDir: string): string {
  return join(dataDir, 'ssl', 'panel');
}

export function panelBootstrapCertPaths(dataDir: string): {
  certPath: string;
  keyPath: string;
  dir: string;
} {
  const dir = panelBootstrapTlsDir(dataDir);
  return {
    dir,
    certPath: join(dir, 'bootstrap-cert.pem'),
    keyPath: join(dir, 'bootstrap-key.pem'),
  };
}

/** Detect primary non-loopback IPv4 for SAN (best-effort). */
export function detectPrimaryIpv4(): string | undefined {
  try {
    const r = spawnSync('hostname', ['-I'], { encoding: 'utf8', timeout: 3000 });
    if (r.status === 0 && r.stdout) {
      for (const part of r.stdout.trim().split(/\s+/)) {
        if (/^\d+\.\d+\.\d+\.\d+$/.test(part) && !part.startsWith('127.')) {
          return part;
        }
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const r = spawnSync(
      'ip',
      ['-4', 'route', 'get', '1.1.1.1'],
      { encoding: 'utf8', timeout: 3000 },
    );
    const m = r.stdout?.match(/\bsrc\s+(\d+\.\d+\.\d+\.\d+)\b/);
    if (m?.[1] && !m[1].startsWith('127.')) return m[1];
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Build OpenSSL -addext subjectAltName value from IPs + DNS names.
 */
export function buildBootstrapSan(input: {
  ips?: string[];
  dns?: string[];
}): string {
  const ips = new Set<string>(['127.0.0.1']);
  for (const ip of input.ips ?? []) {
    const t = String(ip || '').trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(t)) ips.add(t);
  }
  const dns = new Set<string>(['localhost']);
  for (const d of input.dns ?? []) {
    const t = String(d || '').trim().toLowerCase();
    if (t && /^[a-z0-9._-]+$/i.test(t)) dns.add(t);
  }
  const parts = [
    ...[...ips].map((ip) => `IP:${ip}`),
    ...[...dns].map((d) => `DNS:${d}`),
  ];
  return parts.join(',');
}

export type BootstrapPanelTlsResult = {
  ok: boolean;
  notes: string[];
  certPath?: string;
  keyPath?: string;
  fingerprintSha256?: string;
  primaryIp?: string;
  httpsUrl?: string;
  regenerated: boolean;
  configUpdated: boolean;
};

/**
 * Generate (or reuse) self-signed panel cert for IP-first login and enable TLS in config.
 * HTTPS-only: sets tlsHttpsOnly + listenHost 0.0.0.0 by default.
 */
export function ensureBootstrapPanelTls(input: {
  dataDir: string;
  configPath?: string;
  /** Extra IPs for SAN */
  ips?: string[];
  /** Extra DNS names for SAN */
  dns?: string[];
  force?: boolean;
  /** Days validity (default 825 ≈ 27 months) */
  days?: number;
  listenHost?: string;
  listenPort?: number;
}): BootstrapPanelTlsResult {
  const notes: string[] = [];
  const dataDir = input.dataDir;
  if (!dataDir) {
    return { ok: false, notes: ['dataDir required'], regenerated: false, configUpdated: false };
  }
  const configPath = input.configPath ?? join(dataDir, 'config.json');
  const paths = panelBootstrapCertPaths(dataDir);
  const detected = detectPrimaryIpv4();
  const ips = [...(input.ips ?? [])];
  if (detected) ips.unshift(detected);

  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(paths.dir, 0o700);
  } catch {
    /* best-effort */
  }

  let regenerated = false;
  const have =
    existsSync(paths.certPath) &&
    existsSync(paths.keyPath) &&
    !input.force;

  if (have) {
    notes.push('reusing existing bootstrap cert/key');
  } else {
    {
      const ov = spawnSync('openssl', ['version'], { encoding: 'utf8' });
      if (ov.error || ov.status !== 0) {
        return {
          ok: false,
          notes: ['openssl not found — install openssl to bootstrap panel TLS'],
          regenerated: false,
          configUpdated: false,
        };
      }
    }
    const san = buildBootstrapSan({ ips, dns: input.dns });
    const days = input.days ?? 825;
    // OpenSSL 1.1.1+ -addext; write temp config for broader compatibility
    const cnf = join(paths.dir, 'bootstrap-openssl.cnf');
    writeFileSync(
      cnf,
      [
        '[req]',
        'distinguished_name = req_distinguished_name',
        'x509_extensions = v3_req',
        'prompt = no',
        '[req_distinguished_name]',
        'CN = ysk-server-bootstrap',
        'O = YSK Server',
        '[v3_req]',
        'subjectAltName = ' + san,
        'basicConstraints = CA:FALSE',
        'keyUsage = digitalSignature, keyEncipherment',
        'extendedKeyUsage = serverAuth',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    const r = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        paths.keyPath,
        '-out',
        paths.certPath,
        '-days',
        String(days),
        '-config',
        cnf,
        '-extensions',
        'v3_req',
      ],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) {
      return {
        ok: false,
        notes: [
          `openssl failed: ${(r.stderr || r.stdout || '').slice(0, 300)}`,
        ],
        regenerated: false,
        configUpdated: false,
      };
    }
    regenerated = true;
    notes.push(`generated bootstrap cert (SAN ${san})`);
  }

  try {
    chmodSync(paths.keyPath, 0o600);
    chmodSync(paths.certPath, 0o644);
  } catch {
    notes.push('WARN: could not chmod cert/key');
  }

  let fingerprintSha256: string | undefined;
  try {
    const fp = spawnSync(
      'openssl',
      ['x509', '-in', paths.certPath, '-noout', '-fingerprint', '-sha256'],
      { encoding: 'utf8' },
    );
    const line = (fp.stdout || '').trim();
    const m = line.match(/Fingerprint=([0-9A-Fa-f:]+)/);
    fingerprintSha256 = m?.[1] ?? (line || undefined);
    if (fingerprintSha256) notes.push(`SHA256 Fingerprint=${fingerprintSha256}`);
  } catch {
    /* ignore */
  }

  let configUpdated = false;
  if (existsSync(configPath)) {
    const base = readConfigFile(configPath);
    const next = mergePanelTlsConfig(base, {
      tlsEnabled: true,
      tlsCertPath: paths.certPath,
      tlsKeyPath: paths.keyPath,
      tlsHttpsOnly: true,
      listenHost: input.listenHost ?? '0.0.0.0',
    });
    if (input.listenPort != null) next.listenPort = input.listenPort;
    writeConfigFile(configPath, next);
    configUpdated = true;
    notes.push('config.json: tlsEnabled + tlsHttpsOnly + listenHost=0.0.0.0');
  } else {
    notes.push(`config missing at ${configPath} — cert written; run setup then tls bootstrap again`);
  }

  const port = input.listenPort ?? 9287;
  const primaryIp = detected ?? ips.find((i) => i !== '127.0.0.1') ?? '127.0.0.1';
  return {
    ok: true,
    notes,
    certPath: paths.certPath,
    keyPath: paths.keyPath,
    fingerprintSha256,
    primaryIp,
    httpsUrl: `https://${primaryIp}:${port}`,
    regenerated,
    configUpdated,
  };
}

export type PanelTlsStatus = {
  ok: boolean;
  /** Config wants TLS */
  tlsEnabled: boolean;
  /** This process is actually serving HTTPS */
  servingHttps: boolean;
  panelDomain?: string;
  certPath?: string;
  keyPath?: string;
  certExists: boolean;
  keyExists: boolean;
  expiresAt?: string | null;
  listenPort: number;
  listenHost: string;
  /** Suggested operator URL */
  httpsUrl?: string;
  httpUrl?: string;
  notes: string[];
  restartRequired: boolean;
};

export type PanelTlsResult = {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  status: PanelTlsStatus;
  /** True when config.json was updated — serve must restart to apply TLS */
  restartRequired: boolean;
  executed?: boolean;
};

function readConfigFile(configPath: string): YskConfig {
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  return parseConfig(raw);
}

function writeConfigFile(configPath: string, config: YskConfig): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function resolvePanelTlsMaterials(config?: YskConfig | null): {
  certPath?: string;
  keyPath?: string;
  certExists: boolean;
  keyExists: boolean;
  expiresAt?: string | null;
} {
  const certPath = config?.tlsCertPath;
  const keyPath = config?.tlsKeyPath;
  const certExists = Boolean(certPath && existsSync(certPath));
  const keyExists = Boolean(keyPath && existsSync(keyPath));
  let expiresAt: string | null | undefined;
  if (certExists && certPath) {
    expiresAt = parseCertExpiryFromPath(certPath);
  }
  return { certPath, keyPath, certExists, keyExists, expiresAt };
}

/** Materials for https.createServer — null if TLS off or files missing. */
export function loadPanelTlsOptions(config?: YskConfig | null): {
  cert: Buffer;
  key: Buffer;
} | null {
  if (!config?.tlsEnabled) return null;
  const m = resolvePanelTlsMaterials(config);
  if (!m.certExists || !m.keyExists || !m.certPath || !m.keyPath) return null;
  try {
    return {
      cert: readFileSync(m.certPath),
      key: readFileSync(m.keyPath),
    };
  } catch {
    return null;
  }
}

export function getPanelTlsStatus(input: {
  config?: YskConfig | null;
  /** True when this process bound with HTTPS */
  servingHttps?: boolean;
}): PanelTlsStatus {
  const config = input.config;
  const listenPort = config?.listenPort ?? 9287;
  const listenHost = config?.listenHost ?? '127.0.0.1';
  const domain = config?.panelDomain?.trim() || undefined;
  const m = resolvePanelTlsMaterials(config);
  const tlsEnabled = Boolean(config?.tlsEnabled);
  const servingHttps = Boolean(input.servingHttps);
  const notes: string[] = [];
  if (tlsEnabled && (!m.certExists || !m.keyExists)) {
    notes.push(tl('system.panelTls.certMissing'));
  }
  if (tlsEnabled && !servingHttps) {
    notes.push(tl('system.panelTls.restartToApply'));
  }
  const hostLabel =
    domain ||
    (listenHost === '0.0.0.0' || listenHost === '::' ? '127.0.0.1' : listenHost);
  return {
    ok: !tlsEnabled || (m.certExists && m.keyExists),
    tlsEnabled,
    servingHttps,
    panelDomain: domain,
    certPath: m.certPath,
    keyPath: m.keyPath,
    certExists: m.certExists,
    keyExists: m.keyExists,
    expiresAt: m.expiresAt,
    listenPort,
    listenHost,
    httpsUrl: `https://${hostLabel}:${listenPort}`,
    httpUrl: `http://${hostLabel}:${listenPort}`,
    notes,
    restartRequired: tlsEnabled !== servingHttps,
  };
}

/**
 * Enable panel HTTPS: resolve cert for domain (existing LE/managed), write config.
 * Does not restart serve — operator restarts ysk-server (or we try systemctl).
 */
export function enablePanelTls(input: {
  configPath: string;
  dataDir: string;
  domain: string;
  certPath?: string;
  keyPath?: string;
  enabled?: boolean;
}): PanelTlsResult {
  const notes: string[] = [];
  if (!input.configPath || !existsSync(input.configPath)) {
    return {
      ok: false,
      notes: [tl('system.panelTls.noConfig')],
      status: getPanelTlsStatus({}),
      restartRequired: false,
    };
  }
  const domain = input.domain.trim().toLowerCase().replace(/\.$/, '');
  if (!domain) {
    return {
      ok: false,
      notes: [tl('system.panelTls.needDomain')],
      status: getPanelTlsStatus({ config: readConfigFile(input.configPath) }),
      restartRequired: false,
    };
  }

  let certPath = input.certPath?.trim();
  let keyPath = input.keyPath?.trim();
  if (!certPath || !keyPath) {
    const best = resolveBestCertPaths(input.dataDir, domain);
    if (best.exists) {
      certPath = best.fullchain;
      keyPath = best.privkey;
      notes.push(tl('system.panelTls.usingExisting'));
    } else {
      const le = resolveLetsEncryptLivePaths(domain);
      if (le.exists) {
        certPath = le.fullchain;
        keyPath = le.privkey;
        notes.push(tl('system.panelTls.usingLe'));
      }
    }
  }

  if (!certPath || !keyPath || !existsSync(certPath) || !existsSync(keyPath)) {
    return {
      ok: false,
      notes: [tl('system.panelTls.needCertFirst', { domain })],
      status: getPanelTlsStatus({ config: readConfigFile(input.configPath) }),
      restartRequired: false,
    };
  }

  const base = readConfigFile(input.configPath);
  const next = mergePanelTlsConfig(base, {
    tlsEnabled: input.enabled !== false,
    tlsCertPath: certPath,
    tlsKeyPath: keyPath,
    panelDomain: domain,
  });
  writeConfigFile(input.configPath, next);
  notes.push(tl('system.panelTls.configWritten'));
  notes.push(tl('system.panelTls.restartToApply'));

  return {
    ok: true,
    notes,
    status: getPanelTlsStatus({ config: next, servingHttps: false }),
    restartRequired: true,
  };
}

export function disablePanelTls(input: { configPath: string }): PanelTlsResult {
  if (!input.configPath || !existsSync(input.configPath)) {
    return {
      ok: false,
      notes: [tl('system.panelTls.noConfig')],
      status: getPanelTlsStatus({}),
      restartRequired: false,
    };
  }
  const base = readConfigFile(input.configPath);
  const next = mergePanelTlsConfig(base, { tlsEnabled: false });
  writeConfigFile(input.configPath, next);
  return {
    ok: true,
    notes: [tl('system.panelTls.disabledNote'), tl('system.panelTls.restartToApply')],
    status: getPanelTlsStatus({ config: next, servingHttps: false }),
    restartRequired: true,
  };
}

/**
 * Panel-specific ACME: certonly (no nginx --redirect).
 * Tries webroot under dataDir → nginx plugin → standalone (port 80 free).
 */
export async function applyPanelLetsEncrypt(input: {
  domain: string;
  email: string;
  dataDir: string;
  host: HostExecutor;
}): Promise<{
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  commands: string[];
}> {
  const domain = input.domain.trim().toLowerCase().replace(/\.$/, '');
  const email = input.email.trim();
  const notes: string[] = [];
  const commands: string[] = [];

  if (!input.host.executeEnabled()) {
    const blockMessage = panelBlockMessage('no_execute');
    return { ok: false, executed: false, blocked: true, blockMessage, notes: [blockMessage], commands };
  }
  if (!input.host.isRoot()) {
    const blockMessage = panelBlockMessage('no_root');
    return { ok: false, executed: false, blocked: true, blockMessage, notes: [blockMessage], commands };
  }

  const webroot = join(input.dataDir, 'acme-www');
  try {
    mkdirSync(join(webroot, '.well-known', 'acme-challenge'), { recursive: true });
  } catch {
    /* best-effort */
  }

  // Single bash: try strategies in order; succeed if live cert appears
  const script = [
    '#!/usr/bin/env bash',
    'set -u',
    `DOMAIN=${JSON.stringify(domain)}`,
    `EMAIL=${JSON.stringify(email)}`,
    `WEBROOT=${JSON.stringify(webroot)}`,
    'mkdir -p "$WEBROOT/.well-known/acme-challenge"',
    'if ! command -v certbot >/dev/null 2>&1; then echo "certbot missing" >&2; exit 2; fi',
    'try() { echo "trying: $*" >&2; "$@" && return 0; return 1; }',
    // 1) webroot (works if any reverse-proxy serves this path)
    'try certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --keep-until-expiring && exit 0',
    // 2) nginx plugin without --redirect (does not force site redirect)
    'try certbot certonly --nginx -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --keep-until-expiring && exit 0',
    // 3) standalone (needs free :80 — may fail if nginx holds it)
    'try certbot certonly --standalone -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --preferred-challenges http --keep-until-expiring && exit 0',
    'echo "all ACME strategies failed for $DOMAIN" >&2',
    'exit 1',
    '',
  ].join('\n');

  commands.push('certbot certonly (webroot|nginx|standalone)');
  notes.push(tl('system.panelTls.leStrategies'));

  const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 300_000 });
  const live = resolveLetsEncryptLivePaths(domain);
  const ok = r.exitCode === 0 || live.exists;
  if (ok) {
    notes.push(tl('system.panelTls.leOk', { domain }));
  } else {
    const detail = `${r.stderr || ''}\n${r.stdout || ''}`.trim().slice(0, 400);
    notes.push(tl('system.panelTls.leFailed', { detail: detail || `exit ${r.exitCode}` }));
    notes.push(tl('system.panelTls.leHint'));
  }
  return { ok, executed: true, notes, commands };
}

/**
 * Issue LE for panel domain then enable TLS in config.
 */
export async function issueAndEnablePanelTls(input: {
  configPath: string;
  dataDir: string;
  db: YskDatabase;
  host: HostExecutor;
  domain: string;
  email: string;
  actor: string;
}): Promise<PanelTlsResult> {
  const domain = input.domain.trim().toLowerCase();
  const notes: string[] = [];

  // Already have live cert? skip issue
  const existing = resolveBestCertPaths(input.dataDir, domain);
  const le = resolveLetsEncryptLivePaths(domain);
  let issueOk = existing.exists || le.exists;

  if (!issueOk) {
    const r = await applyPanelLetsEncrypt({
      domain,
      email: input.email,
      dataDir: input.dataDir,
      host: input.host,
    });
    notes.push(...(r.notes ?? []));
    if (r.blocked) {
      return {
        ok: false,
        blocked: true,
        blockMessage: r.blockMessage,
        notes,
        status: getPanelTlsStatus({
          config: existsSync(input.configPath) ? readConfigFile(input.configPath) : undefined,
        }),
        restartRequired: false,
        executed: r.executed,
      };
    }
    issueOk = Boolean(r.ok);
    upsertLetsEncryptRecord({
      db: input.db,
      domain,
      email: input.email,
      actor: input.actor,
      ok: issueOk,
      run: true,
      executed: Boolean(r.executed),
      commands: r.commands ?? [],
      notes: r.notes ?? [],
    });
    if (!issueOk) {
      return {
        ok: false,
        notes,
        status: getPanelTlsStatus({
          config: existsSync(input.configPath) ? readConfigFile(input.configPath) : undefined,
        }),
        restartRequired: false,
        executed: true,
      };
    }
  } else {
    notes.push(tl('system.panelTls.certAlreadyPresent'));
  }

  const en = enablePanelTls({
    configPath: input.configPath,
    dataDir: input.dataDir,
    domain,
    enabled: true,
  });
  notes.push(...en.notes);
  // Firewall reminder for panel port
  const port = en.status.listenPort || 9287;
  notes.push(tl('system.panelTls.openFirewall', { port: String(port) }));
  return {
    ok: en.ok,
    notes,
    status: en.status,
    restartRequired: en.restartRequired,
    executed: true,
  };
}

/** Best-effort restart of control plane unit after TLS config change. */
export async function tryRestartPanelService(host: HostExecutor): Promise<{
  ok: boolean;
  notes: string[];
}> {
  if (!host.executeEnabled() || !host.isRoot()) {
    return {
      ok: false,
      notes: [tl('system.panelTls.restartManual')],
    };
  }
  const r = await host.runCommand(['systemctl', 'restart', 'ysk-server'], {
    timeoutMs: 60_000,
  });
  if (r.exitCode === 0) {
    return { ok: true, notes: [tl('system.panelTls.restarted')] };
  }
  return {
    ok: false,
    notes: [
      tl('system.panelTls.restartFailed', {
        detail: (r.stderr || r.stdout || '').slice(0, 200),
      }),
      tl('system.panelTls.restartManual'),
    ],
  };
}

/** Unit path hint under dataDir for tests */
export function panelTlsConfigHint(dataDir: string): string {
  return join(dataDir, 'config.json');
}
