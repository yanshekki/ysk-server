/**
 * VNC display / RFB / noVNC port helpers.
 */

export function rfbPortForDisplay(display: number): number {
  return 5900 + display;
}

export function novncPortForDisplay(display: number): number {
  return 6080 + display;
}

export function sanitizeVncSlug(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
  return s || 'user';
}

export function linuxUserForSlug(slug: string): string {
  const base = sanitizeVncSlug(slug).replace(/-/g, '_').slice(0, 18);
  return `yskvnc_${base}`.slice(0, 32);
}

export function parseGeometry(raw: string): { w: number; h: number } | null {
  const m = String(raw ?? '')
    .trim()
    .match(/^(\d{3,5})x(\d{3,5})$/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w < 640 || h < 480 || w > 7680 || h > 4320) return null;
  return { w, h };
}
