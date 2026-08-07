import { describe, expect, it } from 'vitest';
import {
  buildPhpMyAdminConfigInc,
  defaultDbBrowserProjectName,
  normalizeDbBrowserTool,
} from './db-browser-project.js';

describe('db-browser-project helpers', () => {
  it('normalizes tool ids', () => {
    expect(normalizeDbBrowserTool('adminer')).toBe('adminer');
    expect(normalizeDbBrowserTool('phpmyadmin')).toBe('phpmyadmin');
    expect(normalizeDbBrowserTool('pma')).toBe('phpmyadmin');
    expect(normalizeDbBrowserTool('')).toBe('adminer');
  });

  it('default names include engine', () => {
    expect(defaultDbBrowserProjectName('adminer', 'mysql')).toBe('adminer-mysql');
    expect(defaultDbBrowserProjectName('phpmyadmin', 'mariadb')).toBe('phpmyadmin-mariadb');
    expect(defaultDbBrowserProjectName('adminer')).toBe('adminer');
  });

  it('phpMyAdmin config is HTTP-safe cookie auth with TempDir', () => {
    const cfg = buildPhpMyAdminConfigInc('abc123secret-at-least-32-chars!!');
    expect(cfg).toContain("auth_type'] = 'cookie'");
    expect(cfg).toContain("host'] = '127.0.0.1'");
    expect(cfg).toContain("TempDir'] = __DIR__ . '/tmp'");
    expect(cfg).toContain("ForceSSL'] = false");
    expect(cfg).toContain('abc123secret-at-least-32-chars!!');
  });
});
