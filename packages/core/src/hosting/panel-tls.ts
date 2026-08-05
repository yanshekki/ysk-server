/**
 * Control-plane (panel) TLS — enable HTTPS on ysk-server listenPort.
 * Uses Let's Encrypt live paths or managed dataDir certs; config written to config.json.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { YskConfig } from '../config/schema.js';
import { mergePanelTlsConfig, parseConfig } from '../config/schema.js';
import type { HostExecutor } from '../host/executor.js';
import type { YskDatabase } from '../db/store.js';
import { applyLetsEncrypt } from './system-apply.js';
import {
  parseCertExpiryFromPath,
  resolveBestCertPaths,
  resolveLetsEncryptLivePaths,
  upsertLetsEncryptRecord,
} from './ssl-certs.js';
import { tl } from '@ysk/shared';

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
    const r = await applyLetsEncrypt({
      domain,
      email: input.email,
      host: input.host,
      run: true,
      challenge: 'http-01',
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
