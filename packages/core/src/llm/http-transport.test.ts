import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchTransport } from './http-transport.js';
import { YskError } from 'ysk-server-shared';

describe('fetchTransport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns content from OpenAI-compatible response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          id: 'cmpl-1',
          model: 'test-model',
          choices: [{ message: { content: 'hello untrusted' } }],
        }),
      })),
    );
    const r = await fetchTransport.complete({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(r.content).toBe('hello untrusted');
    expect(r.model).toBe('test-model');
    expect(r.id).toBe('cmpl-1');
  });

  it('throws YskError on HTTP error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'bad key' } }),
      })),
    );
    await expect(
      fetchTransport.complete({
        baseUrl: 'https://api.example.com/v1',
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow(YskError);
  });

  it('throws on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await expect(
      fetchTransport.complete({
        baseUrl: 'http://127.0.0.1:9',
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow(/LLM request failed|ECONNREFUSED/);
  });
});
