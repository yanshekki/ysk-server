import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import {
  loadPanelRuntimeDefaults,
  resolvePanelRuntimeVersion,
  savePanelRuntimeDefault,
} from './runtime-panel-defaults.js';

describe('runtime-panel-defaults', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0;
  });

  it('saves and loads panel default', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-pd-'));
    dirs.push(dataDir);
    expect(loadPanelRuntimeDefaults(dataDir)).toEqual({});
    savePanelRuntimeDefault(dataDir, 'php', '8.3');
    expect(loadPanelRuntimeDefaults(dataDir).php).toBe('8.3');
    expect(resolvePanelRuntimeVersion(dataDir, 'php')).toBe('8.3');
    expect(resolvePanelRuntimeVersion(dataDir, 'node')).toBe('20');
  });
});
