import { randomUUID } from 'node:crypto';
import type { YskDatabase } from '../db/database.js';
import type { StoreAudit } from '../db/store.js';

export type AuditEvent = StoreAudit;

export class AuditRepository {
  constructor(private readonly db: YskDatabase) {}

  append(input: {
    actor: string;
    action: string;
    resource?: string;
    detail: unknown;
    ok: boolean;
  }): AuditEvent {
    const event: AuditEvent = {
      id: randomUUID(),
      actor: input.actor,
      action: input.action,
      resource: input.resource,
      detail: input.detail,
      ok: input.ok,
      created_at: new Date().toISOString(),
    };
    this.db.snapshot.audit_events.unshift(event);
    // cap
    if (this.db.snapshot.audit_events.length > 5000) {
      this.db.snapshot.audit_events.length = 5000;
    }
    this.db.persist();
    return event;
  }

  listRecent(limit = 50): AuditEvent[] {
    return this.db.snapshot.audit_events.slice(0, limit).map((e) => ({ ...e }));
  }
}
