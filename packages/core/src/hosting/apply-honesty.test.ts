import { describe, expect, it } from 'vitest';
import { applyStatusFromHonesty, honestyFromFlags } from './apply-honesty.js';

describe('apply-honesty', () => {
  it('maps written / system / probe into honesty layers', () => {
    expect(honestyFromFlags({ written: false, systemOk: false })).toBe('draft');
    expect(honestyFromFlags({ written: true, systemOk: false })).toBe('written');
    expect(honestyFromFlags({ written: true, systemOk: true, probeOk: false })).toBe(
      'written',
    );
    expect(honestyFromFlags({ written: true, systemOk: true, probeOk: true })).toBe(
      'applied',
    );
    expect(honestyFromFlags({ written: true, systemOk: true })).toBe('applied');
  });

  it('maps layer to apply_status vocabulary', () => {
    expect(applyStatusFromHonesty('applied')).toBe('applied');
    expect(applyStatusFromHonesty('written')).toBe('written');
    expect(applyStatusFromHonesty('draft')).toBe('failed');
  });
});
