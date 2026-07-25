import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listAppTemplates,
  scaffoldAppTemplate,
  readAppPackageName,
  getAppTemplate,
} from './app-templates.js';
import { YskError } from '@ysk/shared';

describe('app templates', () => {
  it('lists known templates', () => {
    const list = listAppTemplates();
    expect(list.some((t) => t.id === 'node-starter')).toBe(true);
    expect(() => getAppTemplate('nope')).toThrow(YskError);
  });

  it('scaffolds node-starter with package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tpl-'));
    try {
      const r = scaffoldAppTemplate({
        templateId: 'node-starter',
        homeDir: dir,
        projectName: 'Demo App',
      });
      expect(r.ok).toBe(true);
      expect(existsSync(join(dir, 'app', 'server.js'))).toBe(true);
      expect(readAppPackageName(dir)).toBe('demo-app');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scaffolds static and wordpress skeletons', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tpl2-'));
    try {
      const s = scaffoldAppTemplate({
        templateId: 'static-site',
        homeDir: dir,
        projectName: 'Site',
      });
      expect(s.docRoot).toContain('public');
      expect(existsSync(join(dir, 'app', 'public', 'index.html'))).toBe(true);

      const w = scaffoldAppTemplate({
        templateId: 'wordpress-php',
        homeDir: join(dir, 'wp'),
        projectName: 'WP',
        force: true,
      });
      expect(existsSync(join(dir, 'wp', 'app', 'public', 'index.php'))).toBe(true);
      expect(w.notes.join(' ')).toMatch(/WordPress/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
