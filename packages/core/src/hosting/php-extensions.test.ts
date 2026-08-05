import { describe, expect, it } from 'vitest';
import {
  defaultPhpExtensionIds,
  listPhpExtensionCatalog,
  phpExtensionCatalogDto,
  resolvePhpAptPackages,
  requiredPhpExtensionIds,
} from './php-extensions.js';

describe('php-extensions', () => {
  it('lists curated extensions with required core', () => {
    const cat = listPhpExtensionCatalog();
    expect(cat.length).toBeGreaterThan(10);
    expect(requiredPhpExtensionIds()).toEqual(
      expect.arrayContaining(['fpm', 'cli', 'common']),
    );
    expect(defaultPhpExtensionIds()).toEqual(
      expect.arrayContaining(['mysql', 'gd', 'mbstring', 'curl', 'xml', 'zip']),
    );
  });

  it('resolves versioned apt packages for 8.2 and 8.3', () => {
    const a = resolvePhpAptPackages('8.2', ['mysql', 'gd', 'redis']);
    expect(a.packages).toEqual(
      expect.arrayContaining([
        'php8.2-fpm',
        'php8.2-cli',
        'php8.2-common',
        'php8.2-mysql',
        'php8.2-gd',
        'php8.2-redis',
      ]),
    );
    const b = resolvePhpAptPackages('8.3', ['pgsql', 'imagick']);
    expect(b.packages).toContain('php8.3-fpm');
    expect(b.packages).toContain('php8.3-pgsql');
    expect(b.packages).toContain('php8.3-imagick');
    expect(b.packages.every((p) => p.startsWith('php8.3-'))).toBe(true);
  });

  it('maps legacy aliases gd2 / mysqli', () => {
    const r = resolvePhpAptPackages('8.1', ['gd2', 'mysqli']);
    expect(r.packages).toContain('php8.1-gd');
    expect(r.packages).toContain('php8.1-mysql');
  });

  it('empty array = required only; null = recommended defaults', () => {
    const only = resolvePhpAptPackages('8.2', []);
    expect(only.packages).toContain('php8.2-fpm');
    expect(only.packages).not.toContain('php8.2-mysql');

    const defs = resolvePhpAptPackages('8.2', null);
    expect(defs.packages).toContain('php8.2-fpm');
    expect(defs.packages).toContain('php8.2-mysql');
  });

  it('dto exposes package names for UI', () => {
    const dto = phpExtensionCatalogDto('8.2');
    expect(dto.version).toBe('8.2');
    expect(dto.extensions.find((e) => e.id === 'gd')?.package).toBe('php8.2-gd');
    expect(dto.defaults).toContain('gd');
  });
});
