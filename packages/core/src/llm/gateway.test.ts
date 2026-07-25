import { describe, expect, it } from 'vitest';
import { echoTransport, LlmGateway } from './gateway.js';

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
    await expect(gw.chat({ messages: [] })).rejects.toThrow(/messages/);
  });
});
