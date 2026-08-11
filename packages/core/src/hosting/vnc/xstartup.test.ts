import { describe, expect, it } from 'vitest';
import { buildXstartup } from './xstartup.js';

describe('buildXstartup', () => {
  it('xfce starts full desktop', () => {
    const s = buildXstartup('xfce');
    expect(s).toContain('startxfce4');
    expect(s).toContain('profile "xfce"');
    expect(s.startsWith('#!/bin/sh')).toBe(true);
  });

  it('minimal uses light WM/terminal and never starts XFCE session', () => {
    const s = buildXstartup('minimal');
    expect(s).not.toMatch(/\bexec startxfce4\b/);
    expect(s).not.toMatch(/\bexec xfce4-session\b/);
    expect(s).toContain('YSK VNC · minimal');
    expect(s).toContain('xsetroot');
    expect(s).toMatch(/openbox|twm|fluxbox|icewm|xterm|xfce4-terminal/);
  });

  it('none is empty canvas without terminal/DE', () => {
    const s = buildXstartup('none');
    expect(s).not.toMatch(/\bexec startxfce4\b/);
    expect(s).not.toMatch(/\bexec xfce4-session\b/);
    expect(s).not.toMatch(/\bexec xterm\b/);
    expect(s).not.toMatch(/\bexec xfce4-terminal\b/);
    expect(s).toContain('xsetroot');
    expect(s).toContain('sleep 86400');
    expect(s).toMatch(/custom|none/i);
  });
});
