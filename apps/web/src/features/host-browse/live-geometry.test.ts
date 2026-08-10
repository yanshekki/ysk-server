import { describe, expect, it } from 'vitest';
import { clientToPage, contentRect } from './live-geometry';

describe('live-geometry', () => {
  it('fit letterboxes and maps center', () => {
    const r = contentRect(1000, 500, 1000, 1000, 'fit');
    // height limited: draw 500x500 centered x
    expect(r.h).toBeCloseTo(500);
    expect(r.w).toBeCloseTo(500);
    expect(r.x).toBeCloseTo(250);
    const p = clientToPage(500, 250, 1000, 500, 1000, 1000, 'fit');
    expect(p.inside).toBe(true);
    expect(p.x).toBeCloseTo(500, 0);
    expect(p.y).toBeCloseTo(500, 0);
  });

  it('outside letterbox is not inside', () => {
    const p = clientToPage(10, 10, 1000, 500, 1000, 1000, 'fit');
    expect(p.inside).toBe(false);
  });
});
