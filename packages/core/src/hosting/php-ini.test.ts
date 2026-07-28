import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getPhpIni,
  loadPhpIniSettings,
  loadProjectPhpIni,
  mergePhpIni,
  renderPhpAdminValueLines,
  renderPhpIniFile,
  savePhpIniSettings,
  saveProjectPhpIni,
} from './php-ini.js';
import { defaultPhpIniValues } from './php-ini-catalog.js';
import { renderPhpFpmPool } from './php-fpm.js';

describe('php-ini', () => {
  it('defaults catalog values and renders ini file', () => {
    const settings = {
      version: '8.2',
      values: defaultPhpIniValues(),
      extra: { variables_order: 'GPCS' },
      rawAppend: '; custom',
    };
    const body = renderPhpIniFile(settings);
    expect(body).toContain('memory_limit = 256M');
    expect(body).toContain('variables_order = GPCS');
    expect(body).toContain('; custom');
  });

  it('saves global and project, merges for admin lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-phpini-'));
    try {
      const saved = savePhpIniSettings(dir, {
        version: '8.2',
        values: { ...defaultPhpIniValues(), memory_limit: '512M' },
        extra: {},
      });
      expect(existsSync(saved.managedIniPath)).toBe(true);
      expect(readFileSync(saved.managedIniPath, 'utf8')).toContain('memory_limit = 512M');

      saveProjectPhpIni(dir, 'proj-1', {
        version: '8.2',
        values: { max_execution_time: 120 },
        extra: {},
      });
      const merged = mergePhpIni(
        loadPhpIniSettings(dir, '8.2'),
        loadProjectPhpIni(dir, 'proj-1', '8.2'),
      );
      expect(merged.values.memory_limit).toBe('512M');
      expect(merged.values.max_execution_time).toBe(120);

      const lines = renderPhpAdminValueLines(merged);
      expect(lines.some((l) => l.includes('php_admin_value[memory_limit]'))).toBe(true);
      expect(lines.some((l) => l.includes('php_admin_value[max_execution_time]'))).toBe(true);
      // bool → flag; int 0/1 must NOT become flag
      expect(lines.some((l) => l.includes('php_admin_flag[display_errors]'))).toBe(true);
      expect(lines.every((l) => !l.includes('php_admin_flag[max_execution_time]'))).toBe(true);

      const pool = renderPhpFpmPool({
        poolName: 'ysk_demo',
        linuxUser: 'ysk_demo',
        phpVersion: '8.2',
        adminValueLines: lines,
      });
      expect(pool).toContain('php_admin_value[memory_limit]');
      expect(pool).toContain('php_admin_flag[display_errors]');

      const get = getPhpIni(dir, '8.2');
      expect(get.catalog.length).toBeGreaterThan(3);
      expect(get.settings.values.memory_limit).toBe('512M');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
