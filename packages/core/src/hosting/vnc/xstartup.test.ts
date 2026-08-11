import { describe, expect, it } from 'vitest';
import { buildXstartup } from './xstartup.js';

describe('buildXstartup', () => {
  it('includes startxfce4 for xfce profile', () => {
    const s = buildXstartup('xfce');
    expect(s).toContain('startxfce4');
    expect(s.startsWith('#!/bin/sh')).toBe(true);
  });

  it('minimal keeps X alive without requiring xterm only', () => {
    const s = buildXstartup('minimal');
    expect(s).toMatch(/startxfce4|xterm|sleep 86400/);
  });

  it('none still provides a keep-alive fallback', () => {
    const s = buildXstartup('none');
    expect(s).toContain('sleep 86400');
  });
});
