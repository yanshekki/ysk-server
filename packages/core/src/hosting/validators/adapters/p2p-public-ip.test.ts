import { describe, expect, it } from 'vitest';
import { composeCommandScript, escapeComposeDollars } from './p2p-public-ip.js';

describe('escapeComposeDollars', () => {
  it('doubles $ so Compose leaves shell vars and $(...) for the container', () => {
    expect(escapeComposeDollars('if [ -n "$PUB" ]; then PUB=$(wget -qO- https://ifconfig.me); fi')).toBe(
      'if [ -n "$$PUB" ]; then PUB=$$(wget -qO- https://ifconfig.me); fi',
    );
  });

  it('indents a command: | block with escaped dollars', () => {
    const block = composeCommandScript('set -e\nif [ -n "$PUB" ]; then echo "$PUB"; fi');
    expect(block).toContain('        if [ -n "$$PUB" ]; then echo "$$PUB"; fi');
    expect(block).not.toMatch(/(^|[^$])\$PUB\b/);
  });
});
