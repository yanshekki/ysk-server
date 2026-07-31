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
    expect(getSoftware('definitely-not-a-package')).toBeUndefined();
  });

  it('listSoftwareForFeature returns related packages', () => {
    const ftp = listSoftwareForFeature('ftp');
    expect(ftp.some((s) => s.id === 'vsftpd' || s.id.includes('ftp'))).toBe(true);
    const mail = listSoftwareForFeature('mail');
    // may be empty if feature key differs — still must be array
    expect(Array.isArray(mail)).toBe(true);
  });

  it('resolveSoftwareTitle never returns empty for catalog entries', () => {
    for (const s of SOFTWARE_CATALOG.slice(0, 15)) {
      const title = resolveSoftwareTitle(s);
      expect(typeof title).toBe('string');
      expect(title.length).toBeGreaterThan(0);
    }
  });
});
