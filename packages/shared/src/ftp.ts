/**
 * FTPS / vsftpd service settings — API contract.
 */

export type FtpBindAddress = 'localhost' | 'public';

export interface FtpsSettingsDto {
  listen: boolean;
  /** vsftpd listen_ipv6; mutually exclusive with classic listen on many builds */
  listenIpv6?: boolean;
  listenPort: number;
  /**
   * Where vsftpd binds. New installs default to localhost.
   * Stored settings without this field are treated as public (legacy).
   */
  bindAddress?: FtpBindAddress;
  sslEnable: boolean;
  forceSsl: boolean;
  sslDomain: string;
  certPath?: string;
  keyPath?: string;
  pasvMin: number;
  pasvMax: number;
  pasvAddress?: string;
  writeEnable: boolean;
  chrootLocalUser: boolean;
  allowWriteableChroot: boolean;
  banner: string;
  guestUsername: string;
}

export interface FtpsStatusDto {
  installed: boolean;
  active: string;
  confManaged: string;
  confSystemExists: boolean;
  accountCount: number;
  settings: FtpsSettingsDto;
  lastAppliedAt?: string;
  liveListen?: boolean | null;
  liveListenIpv6?: boolean | null;
  listenConflict?: boolean;
}

export interface SelectOptionDto {
  value: string;
  label: string;
}

export type FtpsSettings = FtpsSettingsDto;
export type FtpsStatus = FtpsStatusDto;
export type SelectOption = SelectOptionDto;
