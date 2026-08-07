import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listAppTemplates,
  scaffoldAppTemplate,
  readAppPackageName,
  getAppTemplate,
  resolveAppTemplateId,
} from './app-templates.js';
import { YskError } from '@ysk/shared';

describe('app templates', () => {
  it('lists exactly one Hello World template per runtime', () => {
    const list = listAppTemplates();
    expect(list).toHaveLength(9);
    const runtimes = list.map((t) => t.runtime);
    expect(new Set(runtimes).size).toBe(9);
    expect(list.every((t) => t.name === 'Hello World!')).toBe(true);
    expect(list.some((t) => t.id === 'node-hello')).toBe(true);
    expect(list.some((t) => t.id === 'php-hello')).toBe(true);
    // Framework templates no longer listed
    expect(list.some((t) => t.id.includes('wordpress'))).toBe(false);
    expect(list.some((t) => t.id.includes('fastapi'))).toBe(false);
    expect(() => getAppTemplate('nope')).toThrow(YskError);
  });

  it('resolves legacy ids to hello templates', () => {
    expect(resolveAppTemplateId('node-starter')).toBe('node-hello');
    expect(resolveAppTemplateId('python-fastapi')).toBe('python-hello');
    expect(resolveAppTemplateId('wordpress-php')).toBe('php-hello');
    expect(resolveAppTemplateId('rust-axum')).toBe('rust-hello');
    expect(getAppTemplate('go-http').id).toBe('go-hello');
  });

  it('scaffolds node-hello with Hello World', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tpl-'));
    try {
      const r = scaffoldAppTemplate({
        templateId: 'node-hello',
        homeDir: dir,
        projectName: 'Demo App',
      });
      expect(r.ok).toBe(true);
      expect(existsSync(join(dir, 'app', 'server.js'))).toBe(true);
      expect(existsSync(join(dir, 'app', '.ysk-scaffold'))).toBe(true);
      const body = readFileSync(join(dir, 'app', 'server.js'), 'utf8');
      expect(body).toContain('Hello World!');
      expect(readAppPackageName(dir)).toBe('demo-app');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scaffolds legacy node-starter alias', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tpl-legacy-'));
    try {
      const r = scaffoldAppTemplate({
        templateId: 'node-starter',
        homeDir: dir,
        projectName: 'Legacy',
      });
      expect(r.ok).toBe(true);
      expect(r.templateId).toBe('node-hello');
      expect(readFileSync(join(dir, 'app', 'server.js'), 'utf8')).toContain('Hello World!');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scaffolds static and php hello', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tpl2-'));
    try {
      const s = scaffoldAppTemplate({
        templateId: 'static-hello',
        homeDir: dir,
        projectName: 'Site',
      });
      expect(s.docRoot).toContain('public');
      expect(readFileSync(join(dir, 'app', 'public', 'index.html'), 'utf8')).toContain(
        'Hello World!',
      );

      const p = scaffoldAppTemplate({
        templateId: 'php-hello',
        homeDir: join(dir, 'php'),
        projectName: 'Php',
        force: true,
      });
      expect(existsSync(join(dir, 'php', 'app', 'public', 'index.php'))).toBe(true);
      expect(
        readFileSync(join(dir, 'php', 'app', 'public', 'index.php'), 'utf8'),
      ).toContain('Hello World!');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('force re-scaffold covers all listed templates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tpl-force-'));
    try {
      const ids = listAppTemplates().map((t) => t.id);
      for (const id of ids) {
        const home = join(dir, id);
        const first = scaffoldAppTemplate({
          templateId: id,
          homeDir: home,
          projectName: `P-${id}`,
        });
        expect(first.ok).toBe(true);
        const again = scaffoldAppTemplate({
          templateId: id,
          homeDir: home,
          projectName: `P-${id}`,
          force: false,
        });
        expect(again.ok).toBe(true);
        const forced = scaffoldAppTemplate({
          templateId: id,
          homeDir: home,
          projectName: `P2-${id}`,
          force: true,
        });
        expect(forced.ok).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scaffolds process language hellos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tpl-proc-'));
    try {
      for (const id of [
        'python-hello',
        'go-hello',
        'rust-hello',
        'java-hello',
        'kotlin-hello',
        'bun-hello',
      ] as const) {
        const home = join(dir, id);
        const r = scaffoldAppTemplate({
          templateId: id,
          homeDir: home,
          projectName: id,
        });
        expect(r.ok).toBe(true);
        // at least one written file contains Hello World
        const joined = r.written
          .filter((p) => !p.endsWith('.ysk-scaffold'))
          .map((p) => {
            try {
              return readFileSync(p, 'utf8');
            } catch {
              return '';
            }
          })
          .join('\n');
        expect(joined).toContain('Hello World!');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
