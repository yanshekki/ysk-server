import { describe, expect, it } from 'vitest';
import { credentialCopyText, formatHexForDisplay } from './credentials-display';

describe('formatHexForDisplay', () => {
  it('groups long 0x hex and keeps NodeID as-is', () => {
    const hex = `0x${'ab'.repeat(24)}`;
    const shown = formatHexForDisplay(hex);
    expect(shown).toContain('0xabababab');
    expect(shown).toContain('  ');
    expect(shown?.includes('\n')).toBe(true);
    expect(formatHexForDisplay('NodeID-LuxK3nnZVarpC52WEkRYr6RngbpukA29G')).toBeNull();
  });
});

describe('credentialCopyText', () => {
  it('joins labelled raw values and skips empty', () => {
    expect(
      credentialCopyText([
        { label: 'NodeID', value: 'NodeID-abc' },
        { label: 'BLS', value: '  ' },
        { label: 'Proof', value: '0x11' },
      ]),
    ).toBe('NodeID: NodeID-abc\nProof: 0x11');
  });
});
