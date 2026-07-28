import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { FleetService } from './fleet.js';
import { YskError } from '@ysk/shared';

describe('FleetService', () => {
  it('registers (panel), lists, heartbeat, enqueue, pull, ack, remove', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fleet-'));
    const db = openDatabase(join(dir, 'db.json'));
    const fleet = new FleetService(db);

    expect(() => fleet.register('')).toThrow(YskError);
    const s = fleet.register('edge-1', 'default', { region: 'hk' });
    expect(s.agent_id).toBe('edge-1');
    // Panel register is not live
    expect(s.status).toBe('registered');

    const edge = fleet.register('edge-2', 'dc', { source: 'edge' });
    expect(edge.status).toBe('connected');

    const listed = fleet.list();
    expect(listed.some((a) => a.id === s.id)).toBe(true);
    expect(fleet.list('default').some((a) => a.id === s.id)).toBe(true);
    expect(fleet.list('other')).toHaveLength(0);

    const hb = fleet.heartbeat(s.id);
    expect(hb.status).toBe('connected');

    const cmd = fleet.enqueue(s.id, { op: 'ping' });
    expect(cmd.status).toBe('queued');
    const pulled = fleet.pullCommands(s.id);
    expect(pulled.some((c) => c.id === cmd.id)).toBe(true);

    const hist = fleet.listCommands(s.id);
    expect(hist.some((c) => c.id === cmd.id)).toBe(true);

    const acked = fleet.ack(cmd.id, { pong: true });
    expect(acked?.status).toBe('done');
    expect(acked?.result).toEqual({ pong: true });

    const after = fleet.pullCommands(s.id);
    expect(after.every((c) => c.id !== cmd.id)).toBe(true);

    expect(() => fleet.heartbeat('missing')).toThrow(YskError);
    expect(() => fleet.enqueue('missing', {})).toThrow(YskError);

    const removed = fleet.remove(s.id);
    expect(removed.ok).toBe(true);
    expect(fleet.list().every((a) => a.id !== s.id)).toBe(true);

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
