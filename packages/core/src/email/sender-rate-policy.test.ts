import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadDomainRateMap, writeSenderRatePolicyDaemon } from './sender-rate-policy.js';

describe('sender-rate-policy', () => {
  it('loads rates and writes daemon files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-srate-'));
    try {
      const pol = join(dir, 'email', 'policy', 'a.com');
      mkdirSync(pol, { recursive: true });
      writeFileSync(join(pol, 'rate.cf'), '# c\na.com 120\n', 'utf8');
      const map = loadDomainRateMap(dir);
      expect(map['a.com']).toBe(120);
      const w = writeSenderRatePolicyDaemon(dir);
      expect(existsSync(w.scriptPath)).toBe(true);
      expect(existsSync(w.ratesPath)).toBe(true);
      expect(w.written.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
