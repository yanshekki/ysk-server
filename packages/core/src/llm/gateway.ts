/**
 * OpenAI-compatible LLM gateway.
 * All model outputs are marked untrusted and must never be executed directly.
 */

import type { LlmChatRequest, LlmChatResponse } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import { randomUUID } from 'node:crypto';
import type { ProtectionState } from '../services/protection.js';

export interface LlmProviderConfig {
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  /** Optional local-only base URL used when protection.localLlmOnly */
  localBaseUrl?: string;
  localModel?: string;
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
    throw new YskError(ErrorCodes.VALIDATION, '尚未設定 LLM 連線', { httpStatus: 503 });
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
  private protection: ProtectionState | undefined;

  constructor(
    private readonly config: LlmProviderConfig,
    private readonly transport: LlmTransport = nullTransport,
  ) {}

  /**
   * Apply current protection mode (local-LLM-only, etc.).
   */
  setProtection(state: ProtectionState | undefined): void {
    this.protection = state;
  }

  getProtection(): ProtectionState | undefined {
    return this.protection;
  }

  /**
   * Chat completion. Response is ALWAYS untrusted — callers must route tool
   * intentions through Allowlist + Approval, never eval model text.
   * When protection.localLlmOnly is set, remote baseUrl is ignored.
   */
  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    if (!req.messages?.length) {
      throw new YskError(ErrorCodes.VALIDATION, '請提供訊息內容', { httpStatus: 400 });
    }
    for (const m of req.messages) {
      if (!m.role || typeof m.content !== 'string') {
        throw new YskError(ErrorCodes.VALIDATION, '訊息格式無效', { httpStatus: 400 });
      }
    }

    const localOnly = Boolean(this.protection?.localLlmOnly);
    const baseUrl = localOnly
      ? (this.config.localBaseUrl ?? 'http://127.0.0.1:11434')
      : this.config.baseUrl;
    const model = localOnly
      ? (req.model && req.model.startsWith('local')
          ? req.model
          : (this.config.localModel ?? 'local'))
      : (req.model ?? this.config.defaultModel);

    // Refuse clearly remote model ids while local-only
    if (localOnly && req.model && /gpt-|claude|gemini|openai/i.test(req.model)) {
      throw new YskError(
        ErrorCodes.FORBIDDEN,
        `保護模式 ${this.protection?.mode}：已封鎖遠端模型（僅允許本機 LLM）`,
        { httpStatus: 403, details: { model: req.model, mode: this.protection?.mode } },
      );
    }

    const raw = await this.transport.complete({
      baseUrl,
      apiKey: localOnly ? undefined : this.config.apiKey,
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
      throw new YskError(ErrorCodes.LLM_UNTRUSTED, 'LLM 回應格式異常（缺少安全標記）', {
        httpStatus: 500,
      });
    }
  }
}
