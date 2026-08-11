import { describe, expect, it } from 'vitest';
import { buildXstartup } from './xstartup.js';
import { normalizeVncDesktopProfile } from './types.js';

describe('buildXstartup', () => {
  it('xfce starts full desktop', () => {
    const s = buildXstartup('xfce');
    expect(s).toContain('startxfce4');
    expect(s).toContain('profile "xfce"');
  });

  it('terminal only — no XFCE exec', () => {
    const s = buildXstartup('terminal');
    expect(s).not.toMatch(/\bexec startxfce4\b/);
    expect(s).toContain('YSK VNC · terminal');
  });

  it('legacy minimal/none map to terminal profile', () => {
    expect(normalizeVncDesktopProfile('minimal')).toBe('terminal');
    expect(normalizeVncDesktopProfile('none')).toBe('terminal');
    expect(buildXstartup('minimal')).toContain('YSK VNC · terminal');
    expect(buildXstartup('none')).not.toMatch(/\bexec startxfce4\b/);
  });
});
