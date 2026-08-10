import { describe, expect, it } from 'vitest';
import { buildXstartup } from './xstartup.js';

describe('buildXstartup', () => {
  it('includes startxfce4 for xfce profile', () => {
    const s = buildXstartup('xfce');
    expect(s).toContain('startxfce4');
    expect(s.startsWith('#!/bin/sh')).toBe(true);
  });

  it('minimal uses xterm', () => {
    expect(buildXstartup('minimal')).toContain('xterm');
  });

  it('none still provides a fallback shell', () => {
    expect(buildXstartup('none')).toContain('xterm');
  });
});
