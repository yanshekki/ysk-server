/**
 * Persistent fleet agent registry (backed by JsonStore arrays).
 * Panel register ≠ live agent: only heartbeat promotes to connected.
 */

import { randomUUID } from 'node:crypto';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { YskDatabase } from '../db/database.js';

export type FleetAgentStatus = 'registered' | 'connected' | 'stale' | 'disconnected';

export interface FleetAgent {
  id: string;
  agent_id: string;
  group?: string;
  status: FleetAgentStatus;
  connected_at: string;
  last_seen_at: string;
  meta?: Record<string, unknown>;
}

export interface FleetCommand {
  id: string;
  agent_session_id: string;
  payload: unknown;
  status: 'queued' | 'acked' | 'done' | 'error';
  created_at: string;
  result?: unknown;
  finished_at?: string;
}

function agents(db: YskDatabase): FleetAgent[] {
  return db.snapshot.agent_sessions as unknown as FleetAgent[];
}

function messages(db: YskDatabase): Array<Record<string, unknown>> {
  return db.snapshot.agent_messages;
}

function normalizeStatus(raw: string | undefined): FleetAgentStatus {
  if (raw === 'connected' || raw === 'stale' || raw === 'disconnected' || raw === 'registered') {
    return raw;
  }
  return 'registered';
}

export class FleetService {
  constructor(private readonly db: YskDatabase) {}

  /**
   * Control-plane registration only. Does not mean the edge process is online.
   * Real agents call heartbeat after register (or re-register themselves).
   */
  register(agentId: string, group?: string, meta?: Record<string, unknown>): FleetAgent {
    if (!agentId?.trim()) {
      throw new YskError(ErrorCodes.VALIDATION, '請指定 agentId', { httpStatus: 400 });
    }
    const now = new Date().toISOString();
    const fromEdge = Boolean(meta && (meta as { source?: string }).source === 'edge');
    const row: FleetAgent = {
      id: randomUUID(),
      agent_id: agentId.trim(),
      group: group?.trim() || 'default',
      status: fromEdge ? 'connected' : 'registered',
      connected_at: now,
      last_seen_at: now,
      meta,
    };
    agents(this.db).unshift(row);
    messages(this.db).push({
      id: randomUUID(),
      session_id: row.id,
      direction: 'inbound',
      type: 'register',
      payload: { agentId, group: row.group, source: fromEdge ? 'edge' : 'panel' },
      created_at: now,
    });
    this.db.persist();
    return { ...row };
  }

  heartbeat(sessionId: string): FleetAgent {
    const a = agents(this.db).find((x) => x.id === sessionId);
    if (!a) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到 session：${sessionId}`, {
        httpStatus: 404,
      });
    }
    a.last_seen_at = new Date().toISOString();
    a.status = 'connected';
    messages(this.db).push({
      id: randomUUID(),
      session_id: sessionId,
      direction: 'inbound',
      type: 'heartbeat',
      payload: {},
      created_at: a.last_seen_at,
    });
    this.db.persist();
    return { ...a, status: 'connected' };
  }

  list(group?: string): FleetAgent[] {
    const now = Date.now();
    const all = agents(this.db).map((a) => {
      a.status = normalizeStatus(a.status);
      const age = now - new Date(a.last_seen_at).getTime();
      if (a.status === 'connected' && age > 60_000) {
        a.status = 'stale';
      }
      // panel-only register never heartbeated → stay registered (or stale if old)
      if (a.status === 'registered' && age > 300_000) {
        a.status = 'stale';
      }
      return { ...a };
    });
    this.db.persist();
    return group ? all.filter((a) => a.group === group) : all;
  }

  get(sessionId: string): FleetAgent {
    const a = this.list().find((x) => x.id === sessionId);
    if (!a) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到 session：${sessionId}`, {
        httpStatus: 404,
      });
    }
    return a;
  }

  remove(sessionId: string): { ok: true; id: string } {
    const list = agents(this.db);
    const idx = list.findIndex((x) => x.id === sessionId);
    if (idx < 0) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到 session：${sessionId}`, {
        httpStatus: 404,
      });
    }
    list.splice(idx, 1);
    const msgs = messages(this.db);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?.session_id === sessionId) msgs.splice(i, 1);
    }
    this.db.persist();
    return { ok: true, id: sessionId };
  }

  enqueue(sessionId: string, payload: unknown): FleetCommand {
    const a = agents(this.db).find((x) => x.id === sessionId);
    if (!a) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到 session：${sessionId}`, {
        httpStatus: 404,
      });
    }
    const cmd: FleetCommand = {
      id: randomUUID(),
      agent_session_id: sessionId,
      payload,
      status: 'queued',
      created_at: new Date().toISOString(),
    };
    messages(this.db).push({
      id: cmd.id,
      session_id: sessionId,
      direction: 'outbound',
      type: 'command',
      payload,
      status: 'queued',
      created_at: cmd.created_at,
    });
    this.db.persist();
    return cmd;
  }

  /** Queued commands only — for edge agent pull. */
  pullCommands(sessionId: string): FleetCommand[] {
    return messages(this.db)
      .filter(
        (m) =>
          m.session_id === sessionId &&
          m.direction === 'outbound' &&
          m.type === 'command' &&
          (m.status === 'queued' || !m.status),
      )
      .map((m) => ({
        id: String(m.id),
        agent_session_id: sessionId,
        payload: m.payload,
        status: 'queued' as const,
        created_at: String(m.created_at),
      }));
  }

  /** Full command history for panel (queued / done / error). */
  listCommands(sessionId: string): FleetCommand[] {
    const a = agents(this.db).find((x) => x.id === sessionId);
    if (!a) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到 session：${sessionId}`, {
        httpStatus: 404,
      });
    }
    return messages(this.db)
      .filter(
        (m) =>
          m.session_id === sessionId &&
          m.direction === 'outbound' &&
          m.type === 'command',
      )
      .map((m) => ({
        id: String(m.id),
        agent_session_id: sessionId,
        payload: m.payload,
        status: (String(m.status || 'queued') as FleetCommand['status']),
        created_at: String(m.created_at),
        result: m.result,
        finished_at: m.finished_at ? String(m.finished_at) : undefined,
      }))
      .sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
  }

  ack(commandId: string, result?: unknown, error?: boolean): FleetCommand | null {
    const m = messages(this.db).find((x) => x.id === commandId);
    if (!m) return null;
    m.status = error ? 'error' : 'done';
    m.result = result;
    m.finished_at = new Date().toISOString();
    this.db.persist();
    return {
      id: String(m.id),
      agent_session_id: String(m.session_id),
      payload: m.payload,
      status: m.status as FleetCommand['status'],
      created_at: String(m.created_at),
      result: m.result,
      finished_at: String(m.finished_at),
    };
  }
}
