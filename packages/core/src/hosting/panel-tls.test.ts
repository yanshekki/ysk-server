import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyPanelLetsEncrypt,
  buildBootstrapSan,
  disablePanelTls,
  enablePanelTls,
  ensureBootstrapPanelTls,
  getPanelTlsStatus,
  loadPanelTlsOptions,
  resolvePanelTlsMaterials,
} from './panel-tls.js';
import type { YskConfig } from '../config/schema.js';
import type { HostExecutor, RunResult } from '../host/executor.js';

function baseConfig(dataDir: string): YskConfig {
  return {
    version: 1,
    product: 'ysk-server',
    dataDir,
    listenHost: '0.0.0.0',
    listenPort: 9287,
    adminUsername: 'admin',
    locale: 'zh-HK',
    setupCompleted: true,
    createdAt: new Date().toISOString(),
  };
}

describe('panel-tls', () => {
  it('status reflects disabled TLS by default', () => {
    const st = getPanelTlsStatus({ config: baseConfig('/tmp/x') });
    expect(st.tlsEnabled).toBe(false);
    expect(st.servingHttps).toBe(false);
    expect(st.httpsUrl).toContain(':9287');
  });

  it('enable writes config when cert files exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ptls-'));
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, JSON.stringify(baseConfig(dir), null, 2));
    const certDir = join(dir, 'certs', 'panel.test');
    mkdirSync(certDir, { recursive: true });
    // minimal PEM-looking files (TLS load only checks existence for enable)
    const cert = join(certDir, 'fullchain.pem');
    const key = join(certDir, 'privkey.pem');
    writeFileSync(
      cert,
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
    );
    writeFileSync(key, '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n');

    const r = enablePanelTls({
      configPath,
      dataDir: dir,
      domain: 'panel.test',
      certPath: cert,
      keyPath: key,
    });
    expect(r.ok).toBe(true);
    expect(r.restartRequired).toBe(true);
    const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as YskConfig;
    expect(cfg.tlsEnabled).toBe(true);
    expect(cfg.tlsCertPath).toBe(cert);
    expect(cfg.panelDomain).toBe('panel.test');

    const mats = resolvePanelTlsMaterials(cfg);
    expect(mats.certExists).toBe(true);
    expect(loadPanelTlsOptions(cfg)).not.toBeNull();

    const off = disablePanelTls({ configPath });
    expect(off.ok).toBe(true);
    const cfg2 = JSON.parse(readFileSync(configPath, 'utf8')) as YskConfig;
    expect(cfg2.tlsEnabled).toBe(false);
  });

  it('enable fails without cert', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ptls-'));
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, JSON.stringify(baseConfig(dir), null, 2));
    const r = enablePanelTls({
      configPath,
      dataDir: dir,
      domain: 'missing.test',
    });
    expect(r.ok).toBe(false);
    expect(existsSync(configPath)).toBe(true);
  });

  it('buildBootstrapSan includes loopback and custom IP', () => {
    const san = buildBootstrapSan({ ips: ['203.0.113.10'], dns: ['panel.local'] });
    expect(san).toContain('IP:127.0.0.1');
    expect(san).toContain('IP:203.0.113.10');
    expect(san).toContain('DNS:localhost');
    expect(san).toContain('DNS:panel.local');
  });

  it('ensureBootstrapPanelTls generates cert and enables HTTPS-only config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-boot-tls-'));
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, JSON.stringify(baseConfig(dir), null, 2));
    const r = ensureBootstrapPanelTls({
      dataDir: dir,
      configPath,
      ips: ['203.0.113.9'],
      force: true,
    });
    if (!r.ok) {
      // environments without openssl skip
      expect(r.notes.join(' ')).toMatch(/openssl/i);
      return;
    }
    expect(r.regenerated).toBe(true);
    expect(r.configUpdated).toBe(true);
    expect(existsSync(r.certPath!)).toBe(true);
    expect(existsSync(r.keyPath!)).toBe(true);
    const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as YskConfig;
    expect(cfg.tlsEnabled).toBe(true);
    expect(cfg.tlsHttpsOnly).toBe(true);
    expect(cfg.listenHost).toBe('0.0.0.0');
    expect(cfg.tlsCertPath).toBe(r.certPath);
    expect(loadPanelTlsOptions(cfg)).not.toBeNull();
    // idempotent reuse
    const r2 = ensureBootstrapPanelTls({ dataDir: dir, configPath, force: false });
    expect(r2.ok).toBe(true);
    expect(r2.regenerated).toBe(false);
  });

  it('applyPanelLetsEncrypt blocks without execute', async () => {
    const host = {
      executeEnabled: () => false,
      isRoot: () => true,
      runCommand: async () =>
        ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }) as RunResult,
    } as unknown as HostExecutor;
    const r = await applyPanelLetsEncrypt({
      domain: 'panel.test',
      email: 'a@b.c',
      dataDir: '/tmp',
      host,
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });
});

