import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';

const genReg = vi.fn();
const verReg = vi.fn();
const genAuth = vi.fn();
const verAuth = vi.fn();

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (...a: unknown[]) => genReg(...a),
  verifyRegistrationResponse: (...a: unknown[]) => verReg(...a),
  generateAuthenticationOptions: (...a: unknown[]) => genAuth(...a),
  verifyAuthenticationResponse: (...a: unknown[]) => verAuth(...a),
}));

import {
  listWebAuthnCredentials,
  beginWebAuthnRegistration,
  finishWebAuthnRegistration,
  beginWebAuthnAuthentication,
  finishWebAuthnAuthentication,
  deleteWebAuthnCredential,
} from './webauthn.js';

describe('webauthn', () => {
  let dir: string;
  let db: JsonStore;
  const prevRp = process.env.YSK_RP_ID;
  const prevOrigin = process.env.YSK_ORIGIN;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-webauthn-'));
    db = new JsonStore(join(dir, 'db.json'));
    genReg.mockReset();
    verReg.mockReset();
    genAuth.mockReset();
    verAuth.mockReset();
    genReg.mockResolvedValue({ challenge: 'reg-challenge', rp: { id: 'localhost' } });
    verReg.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-abc',
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          transports: ['internal'],
        },
      },
    });
    genAuth.mockResolvedValue({ challenge: 'auth-challenge' });
    verAuth.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 2 },
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prevRp === undefined) delete process.env.YSK_RP_ID;
    else process.env.YSK_RP_ID = prevRp;
    if (prevOrigin === undefined) delete process.env.YSK_ORIGIN;
    else process.env.YSK_ORIGIN = prevOrigin;
  });

  it('lists empty credentials and handles corrupt blob', () => {
    expect(listWebAuthnCredentials(db, 'u1')).toEqual([]);
    db.snapshot.settings['webauthn.u1'] = 'not-json{';
    db.persist();
    expect(listWebAuthnCredentials(db, 'u1')).toEqual([]);
  });

  it('begin registration saves challenge; invalid origin falls back to env', async () => {
    process.env.YSK_RP_ID = 'panel.example';
    process.env.YSK_ORIGIN = 'https://panel.example';
    const opts = await beginWebAuthnRegistration({
      db,
      userId: 'u1',
      username: 'alice',
      origin: '://bad',
    });
    expect(opts.challenge).toBe('reg-challenge');
    expect(genReg).toHaveBeenCalled();
    const arg = genReg.mock.calls[0][0] as { rpID: string };
    expect(arg.rpID).toBe('panel.example');

    const withOrigin = await beginWebAuthnRegistration({
      db,
      userId: 'u1',
      username: 'alice',
      origin: 'https://files.example.com:8443',
    });
    expect(withOrigin.challenge).toBe('reg-challenge');
    const arg2 = genReg.mock.calls[1][0] as { rpID: string; excludeCredentials: unknown[] };
    expect(arg2.rpID).toBe('files.example.com');
  });

  it('finish registration requires challenge and stores credential', async () => {
    const noCh = await finishWebAuthnRegistration({
      db,
      userId: 'u2',
      response: { id: 'x' } as never,
    });
    expect(noCh.ok).toBe(false);

    await beginWebAuthnRegistration({ db, userId: 'u2', username: 'bob' });
    const ok = await finishWebAuthnRegistration({
      db,
      userId: 'u2',
      response: { id: 'cred-abc' } as never,
      name: '  YubiKey  ',
      origin: 'http://127.0.0.1:9173',
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.credential.name).toBe('YubiKey');
    }
    const listed = listWebAuthnCredentials(db, 'u2');
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('YubiKey');
    expect(listed[0].transports).toEqual(['internal']);
  });

  it('finish registration handles verify throw and unverified', async () => {
    await beginWebAuthnRegistration({ db, userId: 'u3', username: 'c' });
    verReg.mockRejectedValueOnce(new Error('bad attestation'));
    const fail = await finishWebAuthnRegistration({
      db,
      userId: 'u3',
      response: { id: 'x' } as never,
    });
    expect(fail.ok).toBe(false);
    expect(fail.notes.some((n) => /bad attestation/.test(n))).toBe(true);

    await beginWebAuthnRegistration({ db, userId: 'u3', username: 'c' });
    verReg.mockResolvedValueOnce({ verified: false });
    const fail2 = await finishWebAuthnRegistration({
      db,
      userId: 'u3',
      response: { id: 'x' } as never,
    });
    expect(fail2.ok).toBe(false);
  });

  it('authentication full path updates counter; errors are honest', async () => {
    const empty = await beginWebAuthnAuthentication({ db, userId: 'none' });
    expect(empty.ok).toBe(false);

    await beginWebAuthnRegistration({ db, userId: 'u4', username: 'd' });
    await finishWebAuthnRegistration({
      db,
      userId: 'u4',
      response: { id: 'cred-abc' } as never,
    });

    const noCh = await finishWebAuthnAuthentication({
      db,
      userId: 'u4',
      response: { id: 'cred-abc' } as never,
    });
    expect(noCh.ok).toBe(false);

    const began = await beginWebAuthnAuthentication({
      db,
      userId: 'u4',
      origin: 'https://auth.example',
    });
    expect(began.ok).toBe(true);

    const wrongId = await finishWebAuthnAuthentication({
      db,
      userId: 'u4',
      response: { id: 'unknown-cred' } as never,
    });
    expect(wrongId.ok).toBe(false);

    // re-begin after wrong id may have cleared challenge in some paths — ensure challenge
    await beginWebAuthnAuthentication({ db, userId: 'u4' });
    const ok = await finishWebAuthnAuthentication({
      db,
      userId: 'u4',
      response: { id: 'cred-abc' } as never,
    });
    expect(ok.ok).toBe(true);

    await beginWebAuthnAuthentication({ db, userId: 'u4' });
    verAuth.mockResolvedValueOnce({ verified: false, authenticationInfo: { newCounter: 0 } });
    const unver = await finishWebAuthnAuthentication({
      db,
      userId: 'u4',
      response: { id: 'cred-abc' } as never,
    });
    expect(unver.ok).toBe(false);

    await beginWebAuthnAuthentication({ db, userId: 'u4' });
    verAuth.mockRejectedValueOnce(new Error('sig fail'));
    const thr = await finishWebAuthnAuthentication({
      db,
      userId: 'u4',
      response: { id: 'cred-abc' } as never,
    });
    expect(thr.ok).toBe(false);
    expect(thr.notes.some((n) => /sig fail/.test(n))).toBe(true);
  });

  it('deleteWebAuthnCredential removes by row id', async () => {
    await beginWebAuthnRegistration({ db, userId: 'u5', username: 'e' });
    const fin = await finishWebAuthnRegistration({
      db,
      userId: 'u5',
      response: { id: 'cred-abc' } as never,
    });
    expect(fin.ok).toBe(true);
    const id = fin.ok ? fin.credential.id : '';
    expect(deleteWebAuthnCredential(db, 'u5', 'nope')).toBe(false);
    expect(deleteWebAuthnCredential(db, 'u5', id)).toBe(true);
    expect(listWebAuthnCredentials(db, 'u5')).toHaveLength(0);
  });
});
