import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeProducerPayload,
  fingerprintProducerBytes,
  producerKeysDirFromSpec,
  readProducerStatus,
  removeProducerKeys,
  validateProducerFile,
  writeProducerFile,
} from './ada-producer.js';
import { buildAdaComposeYaml } from './adapters/ada.js';
import type { ValidatorInstanceDto } from 'ysk-server-shared';

const kesJson = '{"type":"KesSigningKey_ed25519_kes_2^6","description":"KES","cborHex":"aa"}';
const vrfJson = '{"type":"VrfSigningKey_PraosVRF","description":"VRF","cborHex":"bb"}';
const certJson = '{"type":"NodeOperationalCertificate","description":"opcert","cborHex":"cc"}';
const coldJson = '{"type":"StakePoolSigningKey_ed25519","description":"cold","cborHex":"dd"}';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function spec(over: Partial<ValidatorInstanceDto> = {}): ValidatorInstanceDto {
  return {
    id: 'ada-preview-1',
    chain: 'ada',
    network: 'preview',
    profile: 'minimal',
    slug: '1',
    dataPath: '/var/lib/ysk/validators/ada-preview-1/data',
    rpcHost: '127.0.0.1',
    upgradePolicy: 'notify',
    desiredState: 'stopped',
    createdAt: '',
    updatedAt: '',
    clients: { node: { id: 'cardano-node', image: 'ghcr.io/intersectmbo/cardano-node', tag: '11.0.1' } },
    ports: { p2p: 3001, metrics: 12798 },
    ...over,
  };
}

describe('ada producer keys', () => {
  it('accepts KES / VRF / opcert JSON and rejects cold pool keys', () => {
    expect(validateProducerFile('kes', Buffer.from(kesJson))).toEqual({ ok: true });
    expect(validateProducerFile('vrf', Buffer.from(vrfJson)).ok).toBe(true);
    expect(validateProducerFile('opcert', Buffer.from(certJson)).ok).toBe(true);
    expect(validateProducerFile('kes', Buffer.from(coldJson)).ok).toBe(false);
    expect(validateProducerFile('opcert', Buffer.from(coldJson)).error).toBe('producerColdRejected');
    expect(validateProducerFile('kes', Buffer.alloc(0)).error).toBe('producerEmpty');
    expect(validateProducerFile('kes', Buffer.alloc(65 * 1024)).error).toBe('producerTooLarge');
  });

  it('decodes JSON as utf8 and other payloads as base64', () => {
    expect(decodeProducerPayload(kesJson).toString('utf8')).toContain('KesSigningKey');
    const raw = Buffer.from('not-json-bytes');
    const decoded = decodeProducerPayload(raw.toString('base64'));
    expect(decoded.equals(raw)).toBe(true);
  });

  it('writes 0600 files and fingerprints; attached only when all three exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ada-keys-'));
    dirs.push(dir);
    const keys = join(dir, 'keys');
    writeProducerFile(keys, 'kes', Buffer.from(kesJson));
    let st = readProducerStatus(keys);
    expect(st.attached).toBe(false);
    expect(st.kesPresent).toBe(true);
    expect(st.kesFp).toBe(fingerprintProducerBytes(Buffer.from(kesJson)));
    writeProducerFile(keys, 'vrf', Buffer.from(vrfJson));
    writeProducerFile(keys, 'opcert', Buffer.from(certJson));
    st = readProducerStatus(keys, '2026-01-01T00:00:00.000Z');
    expect(st.attached).toBe(true);
    expect(st.attachedAt).toBe('2026-01-01T00:00:00.000Z');
    const data = join(dir, 'ada-preview-1', 'data');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'db'), 'chain');
    const keyDir = producerKeysDirFromSpec(spec({ dataPath: data }));
    expect(keyDir).toBe(join(dir, 'ada-preview-1', 'keys'));
    removeProducerKeys(keys);
    expect(readProducerStatus(keys).attached).toBe(false);
    expect(readProducerStatus(keys).kesPresent).toBe(false);
  });

  it('adds official CARDANO_BLOCK_PRODUCER env and a read-only keys bind only when all three files exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ysk-ada-compose-'));
    dirs.push(root);
    const dataPath = join(root, 'ada-preview-1', 'data');
    const keys = join(root, 'ada-preview-1', 'keys');
    mkdirSync(dataPath, { recursive: true });
    writeProducerFile(keys, 'kes', Buffer.from(kesJson));
    writeProducerFile(keys, 'vrf', Buffer.from(vrfJson));
    writeProducerFile(keys, 'opcert', Buffer.from(certJson));
    const y = buildAdaComposeYaml(spec({ dataPath }));
    expect(y).toContain('NETWORK: preview');
    expect(y).toContain('CARDANO_BLOCK_PRODUCER: "true"');
    expect(y).toContain('CARDANO_CONFIG_JSON_MERGE: "{}"');
    expect(y).toContain('CARDANO_SHELLEY_KES_KEY: /keys/kes.skey');
    expect(y).toContain('CARDANO_SHELLEY_OPERATIONAL_CERTIFICATE: /keys/node.cert');
    expect(y).toContain(':/keys:ro');
    expect(y).not.toMatch(/^\s+command:/m);
    const relay = buildAdaComposeYaml(spec());
    expect(relay).not.toMatch(/CARDANO_BLOCK_PRODUCER|CARDANO_SHELLEY_/);
    expect(relay).not.toContain('/keys');
    const { execFileSync } = await import('node:child_process');
    execFileSync('python3', ['-c', 'import sys,yaml; yaml.safe_load(sys.stdin)'], { input: y });
  });
});
