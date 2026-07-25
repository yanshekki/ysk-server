import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { probeTcp } from './live-checks.js';

describe('probeTcp', () => {
  it('returns true when port accepts connections', async () => {
    const server = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const ok = await probeTcp('127.0.0.1', addr.port, 2000);
    expect(ok).toBe(true);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('returns false for closed port', async () => {
    // high ephemeral unlikely to be listening
    const ok = await probeTcp('127.0.0.1', 1, 500);
    expect(ok).toBe(false);
  });
});
