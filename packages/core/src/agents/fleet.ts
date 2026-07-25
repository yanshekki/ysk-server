/**
 * Persistent fleet agent registry (backed by JsonStore arrays).
 */

import { randomUUID } from 'node:crypto';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { YskDatabase } from '../db/database.js';

export interface FleetAgent {
  id: string;
  agent_id: string;
  group?: string;
  status: 'connected' | 'stale' | 'disconnected';
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
}

function agents(db: YskDatabase): FleetAgent[] {
  return db.snapshot.agent_sessions as unknown as FleetAgent[];
}

function messages(db: YskDatabase): Array<Record<string, unknown>> {
  return db.snapshot.agent_messages;
}

export class FleetService {
  constructor(private readonly db: YskDatabase) {}

  register(agentId: string, group?: string, meta?: Record<string, unknown>): FleetAgent {
    if (!agentId?.trim()) {
      throw new YskError(ErrorCodes.VALIDATION, 'agentId required', { httpStatus: 400 });
    }
    const now = new Date().toISOString();
    const row: FleetAgent = {
      id: randomUUID(),
      agent_id: agentId.trim(),
      group,
      status: 'connected',
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
      payload: { agentId, group },
      created_at: now,
    });
    this.db.persist();
    return { ...row };
  }

  heartbeat(sessionId: string): FleetAgent {
    const a = agents(this.db).find((x) => x.id === sessionId);
    if (!a) {
      throw new YskError(ErrorCodes.NOT_FOUND, `session not found: ${sessionId}`, {
        httpStatus: 404,
      });
    }
    a.last_seen_at = new Date().toISOString();
    a.status = 'connected';
    this.db.persist();
    return { ...a };
  }

  list(group?: string): FleetAgent[] {
    const now = Date.now();
    const all = agents(this.db).map((a) => {
      const stale = now - new Date(a.last_seen_at).getTime() > 60_000;
      if (stale && a.status === 'connected') a.status = 'stale';
      return { ...a };
    });
    this.db.persist();
    return group ? all.filter((a) => a.group === group) : all;
  }

  enqueue(sessionId: string, payload: unknown): FleetCommand {
    const a = agents(this.db).find((x) => x.id === sessionId);
    if (!a) {
      throw new YskError(ErrorCodes.NOT_FOUND, `session not found: ${sessionId}`, {
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

  ack(commandId: string, result?: unknown, error?: boolean): void {
    const m = messages(this.db).find((x) => x.id === commandId);
    if (!m) return;
    m.status = error ? 'error' : 'done';
    m.result = result;
    this.db.persist();
  }
}
