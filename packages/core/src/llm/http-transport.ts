/**
 * Real OpenAI-compatible HTTP transport using fetch.
 */

import type { LlmTransport } from './gateway.js';
import { ErrorCodes, YskError, tl} from '@ysk/shared';

export const fetchTransport: LlmTransport = {
  async complete(input) {
    // SSRF: block cloud metadata / private targets unless local LLM allowed
    const { assertSafeOutboundUrl } = await import('../net/ssrf.js');
    const allowPrivate =
      process.env.YSK_LLM_ALLOW_PRIVATE === '1' ||
      process.env.YSK_LLM_ALLOW_PRIVATE === 'true' ||
      /127\.0\.0\.1|localhost/i.test(input.baseUrl);
    assertSafeOutboundUrl(input.baseUrl, { field: 'llm.baseUrl', allowPrivate });
    const url = input.baseUrl.replace(/\/$/, '') + '/v1/chat/completions';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          temperature: input.temperature ?? 0.2,
        }),
      });
    } catch (err) {
      throw new YskError(ErrorCodes.INTERNAL, tl('notes.auto.t0099', { v0: ((err as Error).message) }), {
        httpStatus: 502,
        cause: err,
      });
    }

    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      throw new YskError(
        ErrorCodes.INTERNAL,
        body.error?.message ?? `LLM HTTP ${res.status}`,
        { httpStatus: 502, details: body },
      );
    }

    const content = body.choices?.[0]?.message?.content ?? '';
    return {
      id: body.id ?? cryptoRandom(),
      content,
      model: body.model ?? input.model,
    };
  },
};

function cryptoRandom(): string {
  return `chatcmpl-${Date.now().toString(36)}`;
}
