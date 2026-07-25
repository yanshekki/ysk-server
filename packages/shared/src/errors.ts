/**
 * Shared error codes used across YSK Server packages.
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
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class YskError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly httpStatus: number;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { details?: unknown; httpStatus?: number; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'YskError';
    this.code = code;
    this.details = options?.details;
    this.httpStatus = options?.httpStatus ?? 500;
  }
}
