/**
 * Cardano SPO hot keys on disk. Never generates keys; rejects cold material.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardanoProducerStatusDto, ValidatorInstanceDto } from 'ysk-server-shared';
import { instanceDir } from './store.js';

export const ADA_PRODUCER_MAX_BYTES = 64 * 1024;

export const ADA_PRODUCER_FILES = {
  kes: 'kes.skey',
  vrf: 'vrf.skey',
  opcert: 'node.cert',
} as const;

export type AdaProducerSlot = keyof typeof ADA_PRODUCER_FILES;

const COLD_TYPE_RE = /cold|genesis|payment|stakepoolsigning/i;
const KES_TYPE_RE = /kes/i;
const VRF_TYPE_RE = /vrf/i;
const OPCERT_TYPE_RE = /operationalcertificate|nodeoperationalcertificate/i;

export function producerKeysDir(dataDir: string, id: string): string {
  return join(instanceDir(dataDir, id), 'keys');
}

export function producerKeysDirFromSpec(spec: ValidatorInstanceDto, dataDir?: string): string {
  if (dataDir) return producerKeysDir(dataDir, spec.id);
  const data = String(spec.dataPath ?? '').replace(/\/+$/, '');
  if (data.endsWith('/data')) return join(data.slice(0, -5), 'keys');
  return join(data, 'keys');
}

export function fingerprintProducerBytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function jsonType(buf: Buffer): string | null {
  const text = buf.toString('utf8').trim();
  if (!text.startsWith('{')) return null;
  try {
    const raw = JSON.parse(text) as { type?: unknown };
    return typeof raw.type === 'string' ? raw.type : null;
  } catch {
    return null;
  }
}

export function decodeProducerPayload(raw: string): Buffer {
  const s = String(raw ?? '');
  const trimmed = s.trim();
  if (!trimmed) return Buffer.alloc(0);
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return Buffer.from(trimmed, 'utf8');
  const b64 = trimmed.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/]+=*$/.test(b64) && b64.length >= 8) {
    try {
      const decoded = Buffer.from(b64, 'base64');
      if (decoded.length > 0) return decoded;
    } catch {
      /* fall through */
    }
  }
  return Buffer.from(s, 'utf8');
}

export function validateProducerFile(
  slot: AdaProducerSlot,
  buf: Buffer,
): { ok: true } | { ok: false; error: 'producerTooLarge' | 'producerColdRejected' | 'producerBadType' | 'producerEmpty' } {
  if (!buf.length) return { ok: false, error: 'producerEmpty' };
  if (buf.length > ADA_PRODUCER_MAX_BYTES) return { ok: false, error: 'producerTooLarge' };
  const type = jsonType(buf);
  if (type && COLD_TYPE_RE.test(type) && !KES_TYPE_RE.test(type) && !VRF_TYPE_RE.test(type) && !OPCERT_TYPE_RE.test(type)) {
    return { ok: false, error: 'producerColdRejected' };
  }
  if (slot === 'kes') {
    if (type && COLD_TYPE_RE.test(type) && !KES_TYPE_RE.test(type)) return { ok: false, error: 'producerColdRejected' };
    if (type && !KES_TYPE_RE.test(type)) return { ok: false, error: 'producerBadType' };
    if (!type) return { ok: false, error: 'producerBadType' };
    return { ok: true };
  }
  if (slot === 'vrf') {
    if (type && COLD_TYPE_RE.test(type) && !VRF_TYPE_RE.test(type)) return { ok: false, error: 'producerColdRejected' };
    if (type && !VRF_TYPE_RE.test(type)) return { ok: false, error: 'producerBadType' };
    if (!type) return { ok: false, error: 'producerBadType' };
    return { ok: true };
  }
  if (type && COLD_TYPE_RE.test(type) && !OPCERT_TYPE_RE.test(type)) {
    return { ok: false, error: 'producerColdRejected' };
  }
  if (type && !OPCERT_TYPE_RE.test(type)) return { ok: false, error: 'producerBadType' };
  return { ok: true };
}

export function writeProducerFile(keysDir: string, slot: AdaProducerSlot, buf: Buffer): string {
  mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(keysDir, 0o700);
  } catch {
    /* umask */
  }
  const path = join(keysDir, ADA_PRODUCER_FILES[slot]);
  writeFileSync(path, buf, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* umask */
  }
  return path;
}

export function removeProducerKeys(keysDir: string): void {
  rmSync(keysDir, { recursive: true, force: true });
}

export function readProducerFile(keysDir: string, slot: AdaProducerSlot): Buffer | null {
  const path = join(keysDir, ADA_PRODUCER_FILES[slot]);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

export function readProducerStatus(keysDir: string, attachedAt?: string | null): CardanoProducerStatusDto {
  const kes = readProducerFile(keysDir, 'kes');
  const vrf = readProducerFile(keysDir, 'vrf');
  const opcert = readProducerFile(keysDir, 'opcert');
  const kesPresent = Boolean(kes?.length);
  const vrfPresent = Boolean(vrf?.length);
  const opcertPresent = Boolean(opcert?.length);
  const attached = kesPresent && vrfPresent && opcertPresent;
  return {
    attached,
    kesPresent,
    vrfPresent,
    opcertPresent,
    kesFp: kes ? fingerprintProducerBytes(kes) : null,
    vrfFp: vrf ? fingerprintProducerBytes(vrf) : null,
    opcertFp: opcert ? fingerprintProducerBytes(opcert) : null,
    attachedAt: attached ? attachedAt ?? null : null,
  };
}

export function adaProducerReady(spec: ValidatorInstanceDto, dataDir?: string): boolean {
  const dir = producerKeysDirFromSpec(spec, dataDir);
  return readProducerStatus(dir, spec.cardanoProducer?.attachedAt).attached;
}

export function enrichCardanoProducer(
  spec: ValidatorInstanceDto,
  dataDir: string,
): ValidatorInstanceDto {
  if (spec.chain !== 'ada') {
    if (!spec.cardanoProducer) return spec;
    const { cardanoProducer: _drop, ...rest } = spec;
    return rest;
  }
  const status = readProducerStatus(producerKeysDir(dataDir, spec.id), spec.cardanoProducer?.attachedAt);
  return { ...spec, cardanoProducer: status };
}
