/**
 * Data Transfer Objects shared between API, CLI, and Web.
 */

import type {
  AgentRuntimeKind,
  ApprovalStatus,
  OperationLevel,
  ProtectionMode,
  ResourceScope,
  RiskTier,
  SystemRole,
  UpdateAdvice,
} from './types.js';

export interface AuthLoginRequest {
  username: string;
  password: string;
}

export interface AuthLoginResponse {
  token: string;
  user: UserDto;
  expiresAt: string;
}

export interface UserDto {
  id: string;
  username: string;
  roles: SystemRole[];
  locale: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'offline';
  product: string;
  version: string;
  protectionMode: ProtectionMode;
  timestamp: string;
}

export interface ApprovalRequestDto {
  id: string;
  action: string;
  risk: RiskTier;
  requestedBy: string;
  status: ApprovalStatus;
  payload: unknown;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface ToolCallRequest {
  tool: string;
  args: Record<string, unknown>;
  dryRun?: boolean;
  scope?: ResourceScope;
}

export interface ToolCallResult {
  allowed: boolean;
  requiresApproval: boolean;
  approvalId?: string;
  dryRun: boolean;
  result?: unknown;
  denialReason?: string;
}

export interface RbacCheckRequest {
  role: SystemRole;
  scope: ResourceScope;
  level: OperationLevel;
}

export interface RbacCheckResponse {
  allowed: boolean;
  reason?: string;
}

export interface LlmChatRequest {
  model?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
}

export interface LlmChatResponse {
  id: string;
  content: string;
  model: string;
  /** Always treat as untrusted */
  untrusted: true;
}

export interface ProjectDto {
  id: string;
  name: string;
  domain?: string;
  linuxUser: string;
  linuxGroup: string;
  homeDir: string;
  runtime: 'node' | 'php' | 'static';
  runtimeVersion?: string;
  env: 'staging' | 'production';
}

export interface SslCertPlan {
  domain: string;
  email: string;
  provider: 'letsencrypt' | 'upload';
  challenge: 'http-01' | 'dns-01';
}

export interface NginxProxyConfig {
  serverName: string;
  upstream: string;
  ssl: boolean;
  cloudflareRealIp: boolean;
}

export interface UpdateItemDto {
  packageName: string;
  currentVersion: string;
  candidateVersion: string;
  advice: UpdateAdvice;
  risk: RiskTier;
  cves: string[];
  requiresApproval: boolean;
  summary: string;
}

export interface SelfUpdateStatus {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  lastCheckAt?: string;
}

export interface EmailDnsRecord {
  type: 'MX' | 'TXT' | 'A' | 'AAAA' | 'CNAME';
  name: string;
  value: string;
  priority?: number;
  importance: 'required' | 'recommended' | 'optional';
  description: string;
}

export interface EmailExternalTodo {
  id: string;
  category: 'dns' | 'ptr' | 'port25' | 'reputation' | 'other';
  title: string;
  description: string;
  required: boolean;
  completed: boolean;
}

export interface EmailHealthReport {
  score: number;
  maxScore: number;
  records: EmailDnsRecord[];
  externalTodos: EmailExternalTodo[];
  ptrOk: boolean;
  port25Open: boolean | null;
  messages: string[];
}

export interface AgentRuntimeDto {
  kind: AgentRuntimeKind;
  name: string;
  version?: string;
  status: 'stopped' | 'running' | 'error' | 'unknown';
  installPath?: string;
}

export interface SetupConfigDto {
  dataDir: string;
  listenHost: string;
  listenPort: number;
  adminUsername: string;
  locale: string;
  nonInteractive: boolean;
}
