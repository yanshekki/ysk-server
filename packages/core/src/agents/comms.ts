/**
 * Remote Agent outbound communication path (control-plane side).
 */

import { ErrorCodes, YskError, tl} from 'ysk-server-shared';
import { randomUUID } from 'node:crypto';

export interface AgentSession {
  id: string;
  agentId: string;
  connectedAt: string;
  lastSeenAt: string;
  status: 'connected' | 'stale' | 'disconnected';
}

export interface AgentMessage {
  id: string;
  sessionId: string;
  direction: 'inbound' | 'outbound';
  type: 'heartbeat' | 'command' | 'result' | 'register';
  payload: unknown;
  createdAt: string;
}

/**
 * In-memory agent registry for MVP control plane.
 */
export class AgentComms {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly messages: AgentMessage[] = [];

  register(agentId: string): AgentSession {
    if (!agentId?.trim()) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0027'), { httpStatus: 400 });
    }
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: randomUUID(),
      agentId: agentId.trim(),
      connectedAt: now,
      lastSeenAt: now,
      status: 'connected' };
    this.sessions.set(session.id, session);
    this.push(session.id, 'inbound', 'register', { agentId });
    return { ...session };
  }

  heartbeat(sessionId: string): AgentSession {
    const s = this.require(sessionId);
    s.lastSeenAt = new Date().toISOString();
    s.status = 'connected';
    this.push(sessionId, 'inbound', 'heartbeat', {});
    return { ...s };
  }

  enqueueCommand(sessionId: string, command: unknown): AgentMessage {
    this.require(sessionId);
    return this.push(sessionId, 'outbound', 'command', command);
  }

  listSessions(): AgentSession[] {
    return [...this.sessions.values()].map((s) => ({ ...s }));
  }

  listMessages(sessionId: string): AgentMessage[] {
    return this.messages.filter((m) => m.sessionId === sessionId).map((m) => ({ ...m }));
  }

  private require(sessionId: string): AgentSession {
    const s = this.sessions.get(sessionId);
    if (!s) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.t0499', { v0: (sessionId) }), {
        httpStatus: 404 });
    }
    return s;
  }

  private push(
    sessionId: string,
    direction: AgentMessage['direction'],
    type: AgentMessage['type'],
    payload: unknown,
  ): AgentMessage {
    const msg: AgentMessage = {
      id: randomUUID(),
      sessionId,
      direction,
      type,
      payload,
      createdAt: new Date().toISOString() };
    this.messages.push(msg);
    return { ...msg };
  }
}
