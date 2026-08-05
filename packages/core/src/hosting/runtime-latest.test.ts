import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getRuntimeLatestHint } from './runtime-latest.js';

describe('runtime-latest', () => {
  it('returns panelLatest from supported list without network requirement', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rl-'));
    const h = await getRuntimeLatestHint({
      dataDir: dir,
      kind: 'php',
      panelSupported: ['8.1', '8.2', '8.3'],
    });
    expect(h.panelLatest).toBe('8.3');
    expect(h.kind).toBe('php');
  });
});
