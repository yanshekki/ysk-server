import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listProjectLogs, tailProjectLog } from './project-logs.js';

describe('project logs', () => {
  it('lists and tails log files safely', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-logs-'));
    try {
      mkdirSync(join(dir, 'logs'), { recursive: true });
      writeFileSync(join(dir, 'logs', 'app.out.log'), 'a\nb\nc\nd\n', 'utf8');
      const files = listProjectLogs(dir);
      expect(files.some((f) => f.name === 'app.out.log')).toBe(true);
      const tail = tailProjectLog(dir, 'app.out.log', 2);
      expect(tail.ok).toBe(true);
      expect(tail.lines.length).toBeLessThanOrEqual(3);
      expect(() => tailProjectLog(dir, '../etc/passwd')).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
