/**
 * AI / LLM feature — tasks + playbooks (untrusted LLM; allowlist only).
 */
import type { AiTask, PlaybookSummary } from '@ysk-server/shared';
import { api } from '../../shared/services/api';

export type { AiTask, PlaybookSummary } from '@ysk-server/shared';

export const llmApi = {
  listTasks: () => api.requestRaw<{ items: AiTask[] }>('/api/v1/ai/tasks'),
  createTask: (body: { prompt: string; enrich?: boolean }) =>
    api.requestRaw<AiTask>('/api/v1/ai/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  approveTask: (id: string) =>
    api.requestRaw(`/api/v1/ai/tasks/${id}/approve`, { method: 'POST' }),
  executeTask: (id: string) =>
    api.requestRaw<AiTask>(`/api/v1/ai/tasks/${id}/execute`, { method: 'POST' }),
  cancelTask: (id: string) =>
    api.requestRaw<AiTask>(`/api/v1/ai/tasks/${id}/cancel`, { method: 'POST' }),
  rejectStep: (id: string, stepId: string) =>
    api.requestRaw<AiTask>(`/api/v1/ai/tasks/${id}/steps/${stepId}/reject`, {
      method: 'POST',
    }),
  listPlaybooks: () =>
    api.requestRaw<{ items: PlaybookSummary[] }>('/api/v1/ai/playbooks'),
  listPlaybookRuns: () =>
    api.requestRaw<{ items: Array<Record<string, unknown>> }>('/api/v1/ai/playbook-runs'),
  runPlaybook: (playbookId: string) =>
    api.requestRaw<{ task: AiTask }>('/api/v1/ai/playbooks/run', {
      method: 'POST',
      body: JSON.stringify({ playbookId }),
    }),
};
