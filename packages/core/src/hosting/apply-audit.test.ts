import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { auditApplyStatuses } from './apply-audit.js';
import type { YskDatabase } from '../db/database.js';

describe('apply-audit', () => {
  it('classifies written/blocked/applied and sorts bad first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-audit-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      store.snapshot.dns_zones = [
        { id: 'z1', zone: 'a.com', apply_status: 'written' },
        { id: 'z2', zone: 'b.com', apply_status: 'blocked' },
        { id: 'z3', zone: 'c.com', apply_status: 'applied' },
      ] as never;
      store.snapshot.projects = [
        {
          id: 'p1',
          name: 'site',
          linux_user: 'u',
          linux_group: 'g',
          home_dir: '/h',
          runtime: 'node',
          env: 'production',
          status: 'suspended',
          os_provisioned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as never;
      store.snapshot.email_domains = [
        {
          id: 'e1',
          domain: 'mail.com',
          apply_status: 'draft',
          last_apply: { ok: true, blocked: true, apply_status: 'applied' },
        },
      ] as never;
      store.snapshot.mysql_databases = [
        { id: 'm1', name: 'appdb', apply_status: 'written' },
      ] as never;
      store.persist();
      const r = auditApplyStatuses(store as unknown as YskDatabase);
      expect(r.summary.total).toBeGreaterThan(3);
      expect(r.summary.bad).toBeGreaterThanOrEqual(1);
      expect(r.findings[0].severity).toBe('bad');
      expect(r.findings.some((f) => f.issue?.includes('written') || f.apply_status === 'written')).toBe(
        true,
      );
      expect(
        r.findings.some((f) => f.issue?.includes('不誠實') || f.issue?.includes('ok=true')),
      ).toBe(true);
      expect(r.findings.some((f) => f.kind === 'mysql_db')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalizeOpsHonesty flips ok when blocked (shared contract)', async () => {
    const { normalizeOpsHonesty } = await import('./apply-audit.js');
    const r = normalizeOpsHonesty({
      ok: true,
      blocked: true,
      notes: ['x'],
      apply_status: 'applied',
    });
    expect(r.ok).toBe(false);
    expect(r.apply_status).toBe('blocked');
  });
});
