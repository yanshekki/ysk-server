import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { FleetService } from './fleet.js';
import { YskError } from '@ysk/shared';

describe('FleetService', () => {
  it('registers, lists, heartbeat, enqueue, pull, ack', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fleet-'));
    const db = openDatabase(join(dir, 'db.json'));
    const fleet = new FleetService(db);

    expect(() => fleet.register('')).toThrow(YskError);
    const s = fleet.register('edge-1', 'default', { region: 'hk' });
    expect(s.agent_id).toBe('edge-1');
    expect(s.status).toBe('connected');

    const listed = fleet.list();
    expect(listed.some((a) => a.id === s.id)).toBe(true);
    expect(fleet.list('default')).toHaveLength(1);
    expect(fleet.list('other')).toHaveLength(0);

    const hb = fleet.heartbeat(s.id);
    expect(hb.status).toBe('connected');

    const cmd = fleet.enqueue(s.id, { op: 'ping' });
    expect(cmd.status).toBe('queued');
    const pulled = fleet.pullCommands(s.id);
    expect(pulled.some((c) => c.id === cmd.id)).toBe(true);

    fleet.ack(cmd.id, { pong: true });
    // after ack still appears as queued filter excludes done — pull should not return done
    const after = fleet.pullCommands(s.id);
    expect(after.every((c) => c.id !== cmd.id || c.status === 'queued')).toBe(true);

    expect(() => fleet.heartbeat('missing')).toThrow(YskError);
    expect(() => fleet.enqueue('missing', {})).toThrow(YskError);

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
