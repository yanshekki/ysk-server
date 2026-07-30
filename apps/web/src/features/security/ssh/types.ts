export type SshIdentityRow = {
  id: string;
  name: string;
  comment?: string;
  algorithm: string;
  fingerprintSha256: string;
  publicKey: string;
  purpose: string;
  binding?: { projectId?: string; linuxUser?: string; homeDir?: string };
  install?: { path?: string; publicPath?: string; installedAt?: string };
  status: string;
  createdAt: string;
  lastVerifiedAt?: string;
  lastVerifyNote?: string;
};

export type SftpKeyRow = {
  id: string;
  username: string;
  comment?: string;
  publicKey: string;
  created_at: string;
  projectId?: string;
  linuxUser?: string;
  homeDir?: string;
};

export type ProjectOpt = {
  id: string;
  name: string;
  linuxUser: string;
  homeDir: string;
};

export type SshSubTab = 'outbound' | 'login' | 'sshd' | '2fa';
