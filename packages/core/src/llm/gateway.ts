/**
 * OpenAI-compatible LLM gateway.
 * All model outputs are marked untrusted and must never be executed directly.
 */

import type { LlmChatRequest, LlmChatResponse } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import { randomUUID } from 'node:crypto';

export interface LlmProviderConfig {
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
}

export interface LlmTransport {
  /**
   * Perform HTTP chat completion. Injected for testability.
   */
  complete(input: {
    baseUrl: string;
    apiKey?: string;
    model: string;
    messages: LlmChatRequest['messages'];
    temperature?: number;
  }): Promise<{ id: string; content: string; model: string }>;
}

/**
 * Default transport that fails closed when no network key is configured —
 * unit tests inject a mock transport.
 */
export const nullTransport: LlmTransport = {
  async complete() {
    throw new YskError(ErrorCodes.VALIDATION, 'No LLM transport configured', { httpStatus: 503 });
  },
};

/**
 * Echo transport for dry/demo mode — still returns untrusted flag.
 */
export const echoTransport: LlmTransport = {
  async complete(input) {
    const last = input.messages[input.messages.length - 1];
    return {
      id: randomUUID(),
      content: `[untrusted-echo] ${last?.content ?? ''}`,
      model: input.model,
    };
  },
};

export class LlmGateway {
  constructor(
    private readonly config: LlmProviderConfig,
    private readonly transport: LlmTransport = nullTransport,
  ) {}

  /**
   * Chat completion. Response is ALWAYS untrusted — callers must route tool
   * intentions through Allowlist + Approval, never eval model text.
   */
  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    if (!req.messages?.length) {
      throw new YskError(ErrorCodes.VALIDATION, 'messages required', { httpStatus: 400 });
    }
    for (const m of req.messages) {
      if (!m.role || typeof m.content !== 'string') {
        throw new YskError(ErrorCodes.VALIDATION, 'invalid message shape', { httpStatus: 400 });
      }
    }
    const model = req.model ?? this.config.defaultModel;
    const raw = await this.transport.complete({
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      model,
      messages: req.messages,
      temperature: req.temperature,
    });
    return {
      id: raw.id,
      content: raw.content,
      model: raw.model,
      untrusted: true,
    };
  }

  /**
   * Explicit guard: reject any attempt to treat model output as executable code.
   */
  assertNotExecutable(response: LlmChatResponse): void {
    if (!response.untrusted) {
      throw new YskError(ErrorCodes.LLM_UNTRUSTED, 'LLM response missing untrusted marker', {
        httpStatus: 500,
      });
    }
  }
}
