/**
 * SSH login 2FA (TOTP via PAM) — independent of panel operator 2FA.
 * Honest stages: enrolled → confirmed → file_written → pam_noted
 */

export type Ssh2faStatus =
  | 'enrolled' // secret generated, not confirmed
  | 'confirmed' // user entered valid code once
  | 'file_written' // ~/.google_authenticator on disk
  | 'retired'
  | 'error';

export type Ssh2faRecord = {
  id: string;
  /** Linux login name */
  linuxUser: string;
  homeDir: string;
  projectId?: string;
  /** AES-GCM blob; never list/get after enroll without reveal */
  secretEnc: string;
  /** First time only in API responses when reveal */
  status: Ssh2faStatus;
  /** otpauth issuer label */
  label: string;
  filePath?: string;
  writtenAt?: string;
  confirmedAt?: string;
  /** If true, secret was copied from panel operator (advanced) */
  fromPanel?: boolean;
  notes: string[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

/** Public list/get — no secretEnc */
export type Ssh2faPublic = Omit<Ssh2faRecord, 'secretEnc'> & {
  hasSecret: boolean;
};

export function toPublicSsh2fa(row: Ssh2faRecord): Ssh2faPublic {
  const { secretEnc: _d, ...rest } = row;
  return { ...rest, hasSecret: Boolean(_d) };
}
