/**
 * SSH identity vault — encrypted private keys for Linux user / panel outbound use.
 * Distinct from inbound authorized_keys (sftp-keys).
 */

export type SshIdentityAlgorithm = 'ed25519' | 'rsa-4096';

export type SshIdentityPurpose = 'user_outbound' | 'panel_outbound' | 'unbound';

export type SshIdentityStatus =
  | 'stored'
  | 'installed'
  | 'verified'
  | 'missing_on_disk'
  | 'retired'
  | 'error';

export type SshIdentityBinding = {
  projectId?: string;
  linuxUser?: string;
  homeDir?: string;
};

export type SshIdentityInstall = {
  /** Absolute path of private key on disk when installed */
  path?: string;
  publicPath?: string;
  installedAt?: string;
  mode?: string;
};

/** Stored record (private always encrypted). */
export type SshIdentity = {
  id: string;
  name: string;
  comment?: string;
  algorithm: SshIdentityAlgorithm;
  fingerprintSha256: string;
  publicKey: string;
  /** AES-256-GCM ciphertext (base64); never return to UI list/get */
  privateKeyEnc: string;
  purpose: SshIdentityPurpose;
  binding?: SshIdentityBinding;
  install?: SshIdentityInstall;
  status: SshIdentityStatus;
  lastVerifiedAt?: string;
  lastVerifyNote?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

/** API / CLI list view — no private material */
export type SshIdentityPublic = Omit<SshIdentity, 'privateKeyEnc'>;

export function toPublicIdentity(row: SshIdentity): SshIdentityPublic {
  const { privateKeyEnc: _drop, ...pub } = row;
  return pub;
}
