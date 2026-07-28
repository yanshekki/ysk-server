import { describe, expect, it } from 'vitest';
import {
  SOFTWARE_CATALOG,
  getSoftware,
  listSoftwareForFeature,
} from './software-catalog.js';

describe('software-catalog', () => {
  it('lists catalog entries by feature', () => {
    expect(SOFTWARE_CATALOG.length).toBeGreaterThan(10);
    expect(getSoftware('nginx')?.bins).toContain('nginx');
    expect(getSoftware('nope')).toBeUndefined();
    const mail = listSoftwareForFeature('email');
    expect(mail.some((s) => s.id === 'postfix' || s.id === 'dovecot')).toBe(true);
    expect(listSoftwareForFeature('all').length).toBeGreaterThanOrEqual(SOFTWARE_CATALOG.length);
  });
});
