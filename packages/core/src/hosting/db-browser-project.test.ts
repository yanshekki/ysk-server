import { describe, expect, it } from 'vitest';
import {
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
});
