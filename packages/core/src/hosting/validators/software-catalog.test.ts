import { describe, expect, it } from 'vitest';
import {
  isPinnedValidatorImage,
  listPinnedValidatorImages,
  parseValidatorImageRef,
  pinnedValidatorImageRefs,
} from './software-catalog.js';

describe('validator software catalog', () => {
  it('lists unique pinned client images from the registry', () => {
    const pins = listPinnedValidatorImages();
    expect(pins.length).toBeGreaterThan(8);
    expect(pins.every((p) => p.image && p.tag && p.ref === `${p.image}:${p.tag}`)).toBe(true);
    expect(pins.some((p) => p.chain === 'eth' && p.clientId === 'reth')).toBe(true);
  });

  it('allowlists only registry pins', () => {
    const refs = pinnedValidatorImageRefs();
    const sample = [...refs][0];
    expect(sample).toBeTruthy();
    expect(isPinnedValidatorImage(sample!)).toBe(true);
    expect(isPinnedValidatorImage('evil/image:latest')).toBe(false);
    expect(isPinnedValidatorImage('not-a-ref')).toBe(false);
    expect(parseValidatorImageRef('ghcr.io/foo/bar:v1')).toEqual({
      image: 'ghcr.io/foo/bar',
      tag: 'v1',
    });
  });
});
