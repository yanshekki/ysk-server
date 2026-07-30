/**
 * SSL certificate registry views — API contract.
 */

export interface CertificateViewDto {
  id: string;
  domain: string;
  provider: string;
  status: string;
  files_exist: boolean;
  fullchain_path?: string;
  privkey_path?: string;
  expires_at?: string | null;
  bytes?: number;
  notes?: string[];
  updated_at?: string;
  commands?: string[];
}

export type CertificateView = CertificateViewDto;
