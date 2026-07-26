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
  /** Optional TOTP when 2FA enabled */
  totp?: string;
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
  /** Operator has confirmed TOTP 2FA */
  totpEnabled?: boolean;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'offline';
  product: string;
  version: string;
  protectionMode: ProtectionMode;
  timestamp: string;
  /** Host can run system mutations (YSK_EXECUTE) */
  executeEnabled?: boolean;
  /** Process running as root */
  isRoot?: boolean;
  /** production_capable when execute + root */
  mode?: 'production_capable' | 'degraded';
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
  /** Extra server_name entries (aliases / www / subdomains) */
  domainAliases?: string[];
  linuxUser: string;
  linuxGroup: string;
  homeDir: string;
  runtime: 'node' | 'php' | 'static';
  runtimeVersion?: string;
  env: 'staging' | 'production';
  /** Control-plane lifecycle: active | running | stopped | suspended | unhealthy | failed | … */
  status?: string;
  port?: number;
  pid?: number;
  processStatus?: string;
  nginxConfigPath?: string;
  /** When SSL published: redirect HTTP → HTTPS */
  forceHttps?: boolean;
  /** HSTS header when SSL published */
  hsts?: boolean;
  /** Whole-site redirect URL */
  siteRedirectUrl?: string;
  httpAuthUser?: string;
  /** Document root relative to homeDir */
  docRoot?: string;
  /** Nginx listen bind IP */
  bindIp?: string;
  lastHealth?: Record<string, unknown>;
  lastDeployAt?: string;
  osProvisioned?: boolean;
  gitUrl?: string;
  gitBranch?: string;
  gitCommit?: string;
  envVars?: Record<string, string>;
  lastBackupPath?: string;
  lastBackupAt?: string;
  /** Disk quota in MiB (null/undefined = unlimited) */
  quotaMb?: number;
  memoryMax?: string;
  cpuQuotaPercent?: number;
}

/** Result of real deploy / publish / health ops */
export interface OpsApplyResultDto {
  ok: boolean;
  projectId: string;
  port?: number;
  pid?: number;
  pidfile?: string;
  url?: string;
  processStatus: string;
  health?: { ok: boolean; status?: number; body?: string; ms?: number; error?: string };
  listening: boolean;
  nginxPath?: string;
  notes: string[];
  written: string[];
}

export interface SslCertPlan {
  domain: string;
  email: string;
  provider: 'letsencrypt' | 'upload';
  challenge: 'http-01' | 'dns-01';
}

export interface NginxProxyConfig {
  /** Space-separated server_name list (primary + aliases) */
  serverName: string;
  upstream: string;
  ssl: boolean;
  cloudflareRealIp: boolean;
  /** Optional paths for uploaded / managed certs (defaults to Let's Encrypt layout) */
  sslCertificate?: string;
  sslCertificateKey?: string;
  /** Separate :80 → 301 https (requires ssl) */
  forceHttps?: boolean;
  /** Strict-Transport-Security when ssl */
  hsts?: boolean;
  /** Whole-site redirect (takes precedence over proxy) */
  siteRedirectUrl?: string;
  /** auth_basic realm user file path */
  authBasicUserFile?: string;
  authBasicRealm?: string;
  /** Optional bind IP for listen (empty = all interfaces) */
  bindIp?: string;
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
  status: 'stopped' | 'running' | 'error' | 'unknown' | 'not_installed';
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
