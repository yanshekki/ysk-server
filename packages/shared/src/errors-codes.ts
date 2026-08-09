/**
 * Shared error code constants (browser + server safe).
 * YskError / yskError live in errors.ts (Node: uses t/tl).
 */

export const ErrorCodes = {
  UNAUTHORIZED: 'YSK_UNAUTHORIZED',
  FORBIDDEN: 'YSK_FORBIDDEN',
  NOT_FOUND: 'YSK_NOT_FOUND',
  VALIDATION: 'YSK_VALIDATION',
  ALLOWLIST_DENIED: 'YSK_ALLOWLIST_DENIED',
  APPROVAL_REQUIRED: 'YSK_APPROVAL_REQUIRED',
  APPROVAL_PENDING: 'YSK_APPROVAL_PENDING',
  APPROVAL_REJECTED: 'YSK_APPROVAL_REJECTED',
  SANDBOX_VIOLATION: 'YSK_SANDBOX_VIOLATION',
  LLM_UNTRUSTED: 'YSK_LLM_UNTRUSTED',
  CONFIG_INVALID: 'YSK_CONFIG_INVALID',
  SETUP_INCOMPLETE: 'YSK_SETUP_INCOMPLETE',
  UPDATE_FAILED: 'YSK_UPDATE_FAILED',
  INTERNAL: 'YSK_INTERNAL',
  /** Host mutations require YSK_EXECUTE */
  NEED_EXECUTE: 'YSK_NEED_EXECUTE',
  NEED_ROOT: 'YSK_NEED_ROOT',
  RATE_LIMITED: 'YSK_RATE_LIMITED',
  TOTP_REQUIRED: 'YSK_TOTP_REQUIRED',
  /** Host-mediated browse blocked by SSRF / mode policy */
  HOST_BROWSE_SSRF: 'YSK_HOST_BROWSE_SSRF',
  /** Host-browse session missing, expired, or not owned */
  HOST_BROWSE_SESSION: 'YSK_HOST_BROWSE_SESSION',
  /** Host-browse upstream fetch failed */
  HOST_BROWSE_UPSTREAM: 'YSK_HOST_BROWSE_UPSTREAM',
  /** Real browser engine requires system Chrome / Chromium */
  HOST_BROWSE_NEED_CHROME: 'YSK_HOST_BROWSE_NEED_CHROME',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
