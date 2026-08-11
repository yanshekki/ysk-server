import { describe, expect, it } from 'vitest';
import { buildXstartup } from './xstartup.js';

describe('buildXstartup', () => {
  it('xfce starts full desktop and may mention startxfce4', () => {
    const s = buildXstartup('xfce');
    expect(s).toContain('startxfce4');
    expect(s).toContain('profile "xfce"');
    expect(s.startsWith('#!/bin/sh')).toBe(true);
  });

  it('minimal never launches XFCE', () => {
    const s = buildXstartup('minimal');
    expect(s).toContain('profile "minimal"');
    expect(s).not.toContain('startxfce4');
    expect(s).not.toContain('xfce4-session');
    expect(s).toMatch(/openbox|xterm|sleep 86400|xfce4-terminal/);
  });

  it('none never auto-starts XFCE and keeps session alive', () => {
    const s = buildXstartup('none');
    expect(s).not.toContain('startxfce4');
    expect(s).not.toContain('xfce4-session');
    expect(s).toContain('sleep 86400');
    expect(s.toLowerCase()).toMatch(/custom|none/);
  });
});
