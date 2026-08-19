import { describe, expect, it } from 'vitest';
import { readRpcJson } from './rpc-json.js';

describe('readRpcJson', () => {
  it('does not throw a JSON syntax error on an empty body', async () => {
    await expect(readRpcJson(new Response('', { status: 200 }))).rejects.toThrow(/rpc unreachable/);
  });

  it('maps 401 to rpc unauthorized', async () => {
    await expect(readRpcJson(new Response('', { status: 401 }))).rejects.toThrow(/rpc unauthorized/);
  });

  it('parses a JSON object', async () => {
    await expect(
      readRpcJson(
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ).resolves.toEqual({ ok: true });
  });
});
