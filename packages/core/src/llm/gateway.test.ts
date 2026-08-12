import { describe, expect, it } from 'vitest';
import { echoTransport, LlmGateway } from './gateway.js';
import { evaluateProtection } from '../services/protection.js';
import { ErrorCodes } from 'ysk-server-shared';

describe('LlmGateway', () => {
  it('marks all model output as untrusted', async () => {
    const gw = new LlmGateway(
      { baseUrl: 'http://localhost:11434', defaultModel: 'local' },
      echoTransport,
    );
    const res = await gw.chat({
      messages: [{ role: 'user', content: 'restart nginx' }],
    });
    expect(res.untrusted).toBe(true);
    expect(res.content).toContain('restart nginx');
    expect(() => gw.assertNotExecutable(res)).not.toThrow();
  });

  it('rejects empty messages', async () => {
    const gw = new LlmGateway(
      { baseUrl: 'http://x', defaultModel: 'm' },
      echoTransport,
    );
    await expect(gw.chat({ messages: [] })).rejects.toThrow(/messages|訊息/i);
  });

  it('enforces localLlmOnly under offline/ddos protection', async () => {
    const gw = new LlmGateway(
      {
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o',
        localBaseUrl: 'http://127.0.0.1:11434',
        localModel: 'local',
      },
      echoTransport,
    );
    gw.setProtection(evaluateProtection({ networkReachable: false }));
    await expect(
      gw.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN });

    const local = await gw.chat({
      messages: [{ role: 'user', content: 'local only' }],
    });
    expect(local.untrusted).toBe(true);
    expect(local.model).toBe('local');
  });
});
