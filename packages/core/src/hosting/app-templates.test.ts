import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
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
    expect(list.some((t) => t.id === 'python-fastapi')).toBe(true);
    expect(list.some((t) => t.id === 'python-flask')).toBe(true);
    expect(list.some((t) => t.id === 'python-django')).toBe(true);
    expect(list.some((t) => t.id === 'rust-axum')).toBe(true);
    expect(list.some((t) => t.id === 'go-http')).toBe(true);
    expect(list.some((t) => t.id === 'rust-http')).toBe(true);
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
      expect(existsSync(join(dir, 'app', '.ysk-scaffold'))).toBe(true);
      expect(readFileSync(join(dir, 'app', '.ysk-scaffold'), 'utf8')).toMatch(/node-starter/);
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

  it('scaffolds python go rust process apps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tpl3-'));
    try {
      const py = scaffoldAppTemplate({
        templateId: 'python-fastapi',
        homeDir: join(dir, 'py'),
        projectName: 'Py API',
      });
      expect(py.entry).toBe('main:app');
      expect(existsSync(join(dir, 'py', 'app', 'main.py'))).toBe(true);
      expect(existsSync(join(dir, 'py', 'app', 'requirements.txt'))).toBe(true);

      const flask = scaffoldAppTemplate({
        templateId: 'python-flask',
        homeDir: join(dir, 'flask'),
        projectName: 'Flask App',
      });
      expect(flask.entry).toBe('app.py');
      expect(existsSync(join(dir, 'flask', 'app', 'app.py'))).toBe(true);

      const dj = scaffoldAppTemplate({
        templateId: 'python-django',
        homeDir: join(dir, 'dj'),
        projectName: 'Dj Site',
      });
      expect(dj.entry).toMatch(/\.wsgi:application$/);
      expect(existsSync(join(dir, 'dj', 'app', 'manage.py'))).toBe(true);

      const ax = scaffoldAppTemplate({
        templateId: 'rust-axum',
        homeDir: join(dir, 'ax'),
        projectName: 'Axum API',
      });
      expect(ax.entry).toMatch(/target\/release/);
      expect(existsSync(join(dir, 'ax', 'app', 'Cargo.toml'))).toBe(true);
      expect(readFileSync(join(dir, 'ax', 'app', 'Cargo.toml'), 'utf8')).toMatch(/axum/);

      const go = scaffoldAppTemplate({
        templateId: 'go-http',
        homeDir: join(dir, 'go'),
        projectName: 'Go API',
      });
      expect(go.entry).toBe('./app');
      expect(existsSync(join(dir, 'go', 'app', 'main.go'))).toBe(true);
      expect(existsSync(join(dir, 'go', 'app', 'go.mod'))).toBe(true);

      const rs = scaffoldAppTemplate({
        templateId: 'rust-http',
        homeDir: join(dir, 'rs'),
        projectName: 'Rust API',
      });
      expect(rs.entry).toMatch(/target\/release/);
      expect(existsSync(join(dir, 'rs', 'app', 'Cargo.toml'))).toBe(true);
      expect(existsSync(join(dir, 'rs', 'app', 'src', 'main.rs'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
