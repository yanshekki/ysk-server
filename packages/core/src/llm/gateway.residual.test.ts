import { describe, expect, it } from 'vitest';
import {
  echoTransport,
  LlmGateway,
  nullTransport,
} from './gateway.js';
import { evaluateProtection } from '../services/protection.js';
import { ErrorCodes, YskError } from '@yanshekki/shared';

describe('LlmGateway residual', () => {
  it('nullTransport fails closed', async () => {
    const gw = new LlmGateway(
      { baseUrl: 'http://x', defaultModel: 'm' },
      nullTransport,
    );
    await expect(
      gw.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION });
  });

  it('rejects invalid message shape', async () => {
    const gw = new LlmGateway(
      { baseUrl: 'http://x', defaultModel: 'm' },
      echoTransport,
    );
    await expect(
      gw.chat({
        messages: [{ role: '', content: 'x' } as never],
      }),
    ).rejects.toThrow(YskError);
    await expect(
      gw.chat({
        messages: [{ role: 'user', content: 1 as never }],
      }),
    ).rejects.toThrow(YskError);
  });

  it('localLlmOnly uses local model ids and strips api key', async () => {
    let seen: { baseUrl?: string; apiKey?: string; model?: string } = {};
    const gw = new LlmGateway(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-secret',
        defaultModel: 'gpt-4o',
        localBaseUrl: 'http://127.0.0.1:11434',
        localModel: 'llama3',
      },
      {
        async complete(input) {
          seen = input;
          return { id: '1', content: 'ok', model: input.model };
        },
      },
    );
    gw.setProtection(evaluateProtection({ networkReachable: false }));
    expect(gw.getProtection()?.localLlmOnly).toBe(true);

    const res = await gw.chat({
      model: 'local-custom',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.untrusted).toBe(true);
    expect(seen.baseUrl).toBe('http://127.0.0.1:11434');
    expect(seen.apiKey).toBeUndefined();
    expect(seen.model).toBe('local-custom');

    const res2 = await gw.chat({
      messages: [{ role: 'user', content: 'def' }],
    });
    expect(seen.model).toBe('llama3');
    expect(res2.model).toBe('llama3');
  });

  it('local-only without localBaseUrl defaults to 11434', async () => {
    let base = '';
    const gw = new LlmGateway(
      { baseUrl: 'https://remote', defaultModel: 'r' },
      {
        async complete(input) {
          base = input.baseUrl;
          return { id: '2', content: 'c', model: input.model };
        },
      },
    );
    gw.setProtection({ mode: 'offline', localLlmOnly: true } as never);
    await gw.chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(base).toBe('http://127.0.0.1:11434');
  });

  it('assertNotExecutable rejects trusted flag', () => {
    const gw = new LlmGateway(
      { baseUrl: 'http://x', defaultModel: 'm' },
      echoTransport,
    );
    expect(() =>
      gw.assertNotExecutable({
        id: '1',
        content: 'rm -rf /',
        model: 'm',
        untrusted: false,
      }),
    ).toThrow(/untrusted|不可|不可信|LLM/i);
  });

  it('remote path uses default model and apiKey', async () => {
    let seen: { model?: string; apiKey?: string } = {};
    const gw = new LlmGateway(
      {
        baseUrl: 'https://api.example/v1',
        apiKey: 'k',
        defaultModel: 'remote-default',
      },
      {
        async complete(input) {
          seen = input;
          return { id: '3', content: 'c', model: input.model };
        },
      },
    );
    await gw.chat({ messages: [{ role: 'user', content: 'z' }], temperature: 0.2 });
    expect(seen.model).toBe('remote-default');
    expect(seen.apiKey).toBe('k');
  });
});
