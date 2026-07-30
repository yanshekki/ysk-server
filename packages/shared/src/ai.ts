/**
 * AI task planner surfaces — API contract (LLM untrusted).
 */

export interface AiTaskStepDto {
  id: string;
  tool: string;
  status: string;
  requiresApproval: boolean;
  error?: string;
}

export interface AiTaskDto {
  id: string;
  prompt: string;
  status: string;
  planSummary: string;
  steps: AiTaskStepDto[];
}

export interface PlaybookSummaryDto {
  id: string;
  name: string;
  description: string;
}

export type AiTask = AiTaskDto;
export type PlaybookSummary = PlaybookSummaryDto;
