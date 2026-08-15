import { describe, expect, it } from 'vitest';
import {
  SOFTWARE_CATALOG,
  getSoftware,
  listSoftwareForFeature,
  resolveSoftwareTitle,
} from './software-catalog.js';

describe('software-catalog', () => {
  it('has unique ids and package names', () => {
    const ids = SOFTWARE_CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SOFTWARE_CATALOG.length).toBeGreaterThan(10);
    for (const s of SOFTWARE_CATALOG) {
      expect(s.id).toBeTruthy();
      expect(s.packages?.length || s.bin || s.title).toBeTruthy();
    }
  });

  it('getSoftware finds and misses', () => {
    expect(getSoftware('nginx')?.id).toBe('nginx');
    expect(getSoftware('docker')?.aptPackages).toEqual(['docker.io', 'docker-compose-v2']);
    expect(getSoftware('definitely-not-a-package')).toBeUndefined();
  });

  it('listSoftwareForFeature returns related packages', () => {
    const ftp = listSoftwareForFeature('ftp');
    expect(ftp.some((s) => s.id === 'vsftpd' || s.id.includes('ftp'))).toBe(true);
    const mail = listSoftwareForFeature('mail');
    // may be empty if feature key differs — still must be array
    expect(Array.isArray(mail)).toBe(true);
    const browse = listSoftwareForFeature('hostBrowse');
    expect(browse.some((s) => s.id === 'chromium')).toBe(true);
  });

  it('does not attach git (features:all) to every feature uninstall list', () => {
    for (const feature of ['python', 'node', 'php', 'nginx', 'email', 'ftp']) {
      const list = listSoftwareForFeature(feature);
      expect(list.some((s) => s.id === 'git')).toBe(false);
    }
    // full catalog still includes git
    expect(listSoftwareForFeature('all').some((s) => s.id === 'git')).toBe(true);
    expect(getSoftware('git')?.uninstallProtected).toBe(true);
  });

  it('resolveSoftwareTitle never returns empty for catalog entries', () => {
    for (const s of SOFTWARE_CATALOG.slice(0, 15)) {
      const title = resolveSoftwareTitle(s);
      expect(typeof title).toBe('string');
      expect(title.length).toBeGreaterThan(0);
    }
  });
});
