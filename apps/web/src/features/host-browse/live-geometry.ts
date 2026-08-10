/**
 * Letterbox geometry for live screencast display ↔ page coordinates.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export function contentRect(
  elW: number,
  elH: number,
  vpW: number,
  vpH: number,
  mode: 'fit' | 'fill' | 'percent',
  zoomPercent = 100,
): Rect {
  if (vpW <= 0 || vpH <= 0 || elW <= 0 || elH <= 0) {
    return { x: 0, y: 0, w: elW, h: elH };
  }
  let scale: number;
  if (mode === 'fill') {
    scale = Math.max(elW / vpW, elH / vpH);
  } else if (mode === 'percent') {
    scale = (zoomPercent / 100) * Math.min(elW / vpW, elH / vpH);
  } else {
    scale = Math.min(elW / vpW, elH / vpH);
  }
  const w = vpW * scale;
  const h = vpH * scale;
  return {
    x: (elW - w) / 2,
    y: (elH - h) / 2,
    w,
    h,
  };
}

/** Map client coords (relative to element) to page viewport pixels. */
export function clientToPage(
  relX: number,
  relY: number,
  elW: number,
  elH: number,
  vpW: number,
  vpH: number,
  mode: 'fit' | 'fill' | 'percent',
  zoomPercent = 100,
): { x: number; y: number; inside: boolean } {
  const r = contentRect(elW, elH, vpW, vpH, mode, zoomPercent);
  const inside =
    relX >= r.x && relX <= r.x + r.w && relY >= r.y && relY <= r.y + r.h;
  const x = ((relX - r.x) / r.w) * vpW;
  const y = ((relY - r.y) / r.h) * vpH;
  return {
    x: Math.round(Math.min(vpW, Math.max(0, x))),
    y: Math.round(Math.min(vpH, Math.max(0, y))),
    inside,
  };
}
