/**
 * Security feature — tools, approvals, host probe.
 */
import { api } from '../../shared/services/api';

export const securityApi = {
  listTools: () => api.listTools(),
  listApprovals: () => api.listApprovals(),
  approve: (id: string) => api.approve(id),
  executeTool: (body: { tool: string; args: Record<string, unknown> }) =>
    api.executeTool(body),
};
