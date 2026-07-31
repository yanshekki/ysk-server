import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStore } from '../../db/store.js';
import {
  createRememberDeviceToken,
  listRememberDevices,
  revokeAllRememberDevices,
  revokeRememberDevice,
  verifyRememberDeviceToken,
} from './remember-device.js';

describe('remember-device', () => {
  let dataDir: string;
  let db: JsonStore;
  const prevKey = process.env.YSK_SECRETS_KEY;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ysk-remdev-'));
    db = new JsonStore(join(dataDir, 'db.json'));
    delete process.env.YSK_SECRETS_KEY;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.YSK_SECRETS_KEY;
    else process.env.YSK_SECRETS_KEY = prevKey;
  });

  it('creates token that verifies for same user and fails for others', () => {
    const { token, deviceId, expiresAt } = createRememberDeviceToken({
      dataDir,
      db,
      userId: 'user-a',
      userAgent: 'VitestAgent/1.0',
      ip: '203.0.113.5',
      days: 7,
    });
    expect(token.startsWith('yskdev_')).toBe(true);
    expect(deviceId).toMatch(/^[0-9a-f]{24}$/);
    expect(Number.isFinite(Date.parse(expiresAt))).toBe(true);

    expect(
      verifyRememberDeviceToken({ dataDir, db, userId: 'user-a', token }),
    ).toBe(true);
    expect(
      verifyRememberDeviceToken({ dataDir, db, userId: 'user-b', token }),
    ).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(
      verifyRememberDeviceToken({ dataDir, db, userId: 'u', token: 'not-a-token' }),
    ).toBe(false);
    expect(
      verifyRememberDeviceToken({ dataDir, db, userId: 'u', token: 'yskdev_' }),
    ).toBe(false);
    expect(
      verifyRememberDeviceToken({
        dataDir,
        db,
        userId: 'u',
        token: 'yskdev_abc.nosig',
      }),
    ).toBe(false);
  });

  it('rejects tampered signature', () => {
    const { token } = createRememberDeviceToken({
      dataDir,
      db,
      userId: 'user-a',
    });
    const [head, sig] = token.split('.');
    const bad = `${head}.${sig!.slice(0, -2)}xx`;
    expect(
      verifyRememberDeviceToken({ dataDir, db, userId: 'user-a', token: bad }),
    ).toBe(false);
  });

  it('lists devices and revoke by id / all', () => {
    const a = createRememberDeviceToken({
      dataDir,
      db,
      userId: 'u1',
      userAgent: 'A',
      ip: '10.0.0.1',
    });
    const b = createRememberDeviceToken({
      dataDir,
      db,
      userId: 'u1',
      userAgent: 'B',
      ip: '10.0.0.2',
    });
    // other user
    createRememberDeviceToken({ dataDir, db, userId: 'u2' });

    const list = listRememberDevices(db, 'u1');
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.id).sort()).toEqual([a.deviceId, b.deviceId].sort());
    expect(list.find((d) => d.id === a.deviceId)?.user_agent).toBe('A');
    expect(list.find((d) => d.id === a.deviceId)?.ip).toBe('10.0.0.1');

    expect(revokeRememberDevice(db, 'u1', a.deviceId)).toBe(true);
    expect(revokeRememberDevice(db, 'u1', a.deviceId)).toBe(false);
    expect(
      verifyRememberDeviceToken({ dataDir, db, userId: 'u1', token: a.token }),
    ).toBe(false);
    expect(
      verifyRememberDeviceToken({ dataDir, db, userId: 'u1', token: b.token }),
    ).toBe(true);

    const n = revokeAllRememberDevices(db, 'u1');
    expect(n).toBe(1);
    expect(listRememberDevices(db, 'u1')).toHaveLength(0);
    expect(
      verifyRememberDeviceToken({ dataDir, db, userId: 'u1', token: b.token }),
    ).toBe(false);
  });

  it('caps stored devices at 10 (FIFO)', () => {
    const tokens: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = createRememberDeviceToken({
        dataDir,
        db,
        userId: 'cap',
        userAgent: `ua-${i}`,
      });
      tokens.push(r.token);
    }
    expect(listRememberDevices(db, 'cap')).toHaveLength(10);
    // earliest two should be gone
    expect(
      verifyRememberDeviceToken({ dataDir, db, userId: 'cap', token: tokens[0]! }),
    ).toBe(false);
    expect(
      verifyRememberDeviceToken({ dataDir, db, userId: 'cap', token: tokens[1]! }),
    ).toBe(false);
    expect(
      verifyRememberDeviceToken({ dataDir, db, userId: 'cap', token: tokens[11]! }),
    ).toBe(true);
  });

  it('persists devices across JsonStore reopen', () => {
    const { token } = createRememberDeviceToken({
      dataDir,
      db,
      userId: 'persist',
    });
    const db2 = new JsonStore(join(dataDir, 'db.json'));
    expect(
      verifyRememberDeviceToken({ dataDir, db: db2, userId: 'persist', token }),
    ).toBe(true);
  });
});
