export type ApacheSiteKind = 'proxy' | 'static' | 'php';

export type ApacheBodySize = '1m' | '10m' | '50m' | '100m' | '500m';

export type ApacheGlobalSettings = {
  gzip: boolean;
  serverTokens: boolean;
  clientMaxBody: ApacheBodySize;
  keepalive: '15' | '65' | '120';
  http2: boolean;
  accessLog: 'off' | 'on';
};

export const DEFAULT_APACHE_SETTINGS: ApacheGlobalSettings = {
  gzip: true,
  serverTokens: false,
  clientMaxBody: '10m',
  keepalive: '65',
  http2: true,
  accessLog: 'on',
};

export type ApacheSiteRecord = {
  id: string;
  serverName: string;
  kind: ApacheSiteKind;
  upstream?: string;
  root?: string;
  ssl?: boolean;
  forceHttps?: boolean;
  hsts?: boolean;
  clientMaxBody?: ApacheBodySize | 'inherit';
  indexes?: boolean;
  confPath?: string;
  apply_status?: string;
  created_at?: string;
  updated_at?: string;
};
