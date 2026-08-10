import { describe, expect, it } from 'vitest';
import {
  linuxUserForSlug,
  novncPortForDisplay,
  parseGeometry,
  rfbPortForDisplay,
  sanitizeVncSlug,
} from './ports.js';

describe('vnc ports helpers', () => {
  it('maps display to RFB/noVNC ports', () => {
    expect(rfbPortForDisplay(1)).toBe(5901);
    expect(rfbPortForDisplay(10)).toBe(5910);
    expect(novncPortForDisplay(1)).toBe(6081);
  });

  it('sanitizes slug and linux user', () => {
    expect(sanitizeVncSlug('Alice Desktop!')).toBe('alice_desktop');
    expect(linuxUserForSlug('Alice')).toMatch(/^yskvnc_alice$/);
    expect(linuxUserForSlug('')).toMatch(/^yskvnc_/);
  });

  it('parses geometry', () => {
    expect(parseGeometry('1920x1080')).toEqual({ w: 1920, h: 1080 });
    expect(parseGeometry('bad')).toBeNull();
    expect(parseGeometry('100x100')).toBeNull();
  });
});
