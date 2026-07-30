import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSshIdentity,
  importSshIdentity,
  listSshIdentities,
  getSshIdentity,
  exportSshIdentityPrivate,
  deleteSshIdentity,
} from './store.js';
import { encryptPrivateKey, decryptPrivateKey, resolveMasterKey } from './crypto.js';
import { installSshIdentity, uninstallSshIdentity } from './install.js';
import { generateSshKeyPair, fingerprintFromPublicKey } from './generate.js';
import {
  parseSshTarget,
  rotateSshIdentity,
  resolveIdentityKeyPath,
  testSshIdentity,
} from './ops.js';

describe('ssh-identity crypto', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ysk-ssh-test-'));
    delete process.env.YSK_SECRETS_KEY;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.YSK_SECRETS_KEY;
  });

  it('roundtrips encrypt/decrypt with AAD', () => {
    const { key } = resolveMasterKey(dataDir);
    const id = 'id-1';
    const plain = '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n';
    const enc = encryptPrivateKey(key, id, plain);
    expect(enc).not.toContain('PRIVATE');
    expect(decryptPrivateKey(key, id, enc)).toBe(plain);
    expect(() => decryptPrivateKey(key, 'other-id', enc)).toThrow();
  });

  it('generates master key file once', () => {
    const a = resolveMasterKey(dataDir);
    expect(a.source).toBe('generated');
    const b = resolveMasterKey(dataDir);
    expect(b.source).toBe('file');
    expect(Buffer.compare(a.key, b.key)).toBe(0);
  });
});

describe('ssh-identity generate + store', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ysk-ssh-store-'));
    delete process.env.YSK_SECRETS_KEY;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('generates ed25519 pair with fingerprint', () => {
    const pair = generateSshKeyPair({ algorithm: 'ed25519', comment: 'test@ysk' });
    expect(pair.publicKey.startsWith('ssh-ed25519 ')).toBe(true);
    expect(pair.privateKey).toContain('OPENSSH PRIVATE KEY');
    expect(pair.fingerprintSha256.startsWith('SHA256:')).toBe(true);
    expect(fingerprintFromPublicKey(pair.publicKey)).toBe(pair.fingerprintSha256);
  });

  it('create stores encrypted and redacts list', () => {
    const r = createSshIdentity(dataDir, {
      name: 'proj-a',
      purpose: 'user_outbound',
      binding: { linuxUser: 'ysks_a', homeDir: join(dataDir, 'home-a') },
      revealPrivate: true,
    });
    expect(r.ok).toBe(true);
    expect(r.privateKey).toContain('PRIVATE');
    expect(r.identity?.fingerprintSha256).toMatch(/^SHA256:/);
    expect((r.identity as { privateKeyEnc?: string })?.privateKeyEnc).toBeUndefined();

    const list = listSshIdentities(dataDir);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('proj-a');
    expect(JSON.stringify(list)).not.toContain('PRIVATE KEY');

    const got = getSshIdentity(dataDir, r.identity!.id);
    expect(got?.publicKey).toContain('ssh-');

    const exp = exportSshIdentityPrivate(dataDir, r.identity!.id);
    expect(exp.ok).toBe(true);
    expect(exp.privateKey).toContain('PRIVATE');
  });

  it('import and delete', () => {
    const pair = generateSshKeyPair({ comment: 'imp' });
    const imp = importSshIdentity(dataDir, {
      name: 'imported',
      privateKey: pair.privateKey,
      purpose: 'panel_outbound',
    });
    expect(imp.ok).toBe(true);
    expect(imp.identity?.fingerprintSha256).toBe(pair.fingerprintSha256);

    const dup = importSshIdentity(dataDir, {
      name: 'dup',
      privateKey: pair.privateKey,
    });
    expect(dup.ok).toBe(false);

    const del = deleteSshIdentity(dataDir, imp.identity!.id);
    expect(del.ok).toBe(true);
    expect(listSshIdentities(dataDir)).toHaveLength(0);
  });

  it('install dry-run then apply to panel path', async () => {
    const r = createSshIdentity(dataDir, {
      name: 'panel',
      purpose: 'panel_outbound',
    });
    expect(r.ok).toBe(true);
    const id = r.identity!.id;

    const dry = await installSshIdentity({ dataDir, id, apply: false });
    expect(dry.ok).toBe(true);
    expect(dry.dryRun).toBe(true);
    expect(dry.applied).toBe(false);
    expect(existsSync(dry.plannedPath!)).toBe(false);

    const applied = await installSshIdentity({
      dataDir,
      id,
      apply: true,
      executeEnabled: true,
    });
    expect(applied.ok).toBe(true);
    expect(applied.applied).toBe(true);
    expect(existsSync(applied.plannedPath!)).toBe(true);
    const body = readFileSync(applied.plannedPath!, 'utf8');
    expect(body).toContain('PRIVATE');

    const un = await uninstallSshIdentity({ dataDir, id, apply: true });
    expect(un.ok).toBe(true);
    expect(existsSync(applied.plannedPath!)).toBe(false);
  });

  it('install blocked without execute', async () => {
    const r = createSshIdentity(dataDir, { name: 'x', purpose: 'panel_outbound' });
    const blocked = await installSshIdentity({
      dataDir,
      id: r.identity!.id,
      apply: true,
      executeEnabled: false,
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.ok).toBe(false);
  });

  it('parseSshTarget', () => {
    expect(parseSshTarget('root@10.0.0.1:2222')).toEqual({
      user: 'root',
      host: '10.0.0.1',
      port: 2222,
    });
    expect(parseSshTarget('deploy@box')).toEqual({
      user: 'deploy',
      host: 'box',
      port: 22,
    });
    expect(parseSshTarget('onlyhost')).toEqual({
      user: 'root',
      host: 'onlyhost',
      port: 22,
    });
    expect(parseSshTarget('')).toBeNull();
  });

  it('rotate retires old and creates new', () => {
    const r = createSshIdentity(dataDir, { name: 'rot', purpose: 'panel_outbound' });
    const oldFp = r.identity!.fingerprintSha256;
    const rot = rotateSshIdentity({
      dataDir,
      id: r.identity!.id,
      revealPrivate: true,
    });
    expect(rot.ok).toBe(true);
    expect(rot.oldIdentity?.status).toBe('retired');
    expect(rot.newIdentity?.fingerprintSha256).not.toBe(oldFp);
    expect(rot.privateKey).toContain('PRIVATE');
    expect(listSshIdentities(dataDir).length).toBeGreaterThanOrEqual(2);
  });

  it('test dry-run plans ssh without execute', async () => {
    const r = createSshIdentity(dataDir, { name: 't', purpose: 'panel_outbound' });
    const path = resolveIdentityKeyPath(dataDir, r.identity!.id);
    expect(path.ok).toBe(true);
    const dry = await testSshIdentity({
      dataDir,
      id: r.identity!.id,
      target: 'root@127.0.0.1',
      apply: false,
    });
    expect(dry.ok).toBe(true);
    expect(dry.dryRun).toBe(true);
    expect(dry.notes.some((n) => n.includes('ssh'))).toBe(true);
  });
});
