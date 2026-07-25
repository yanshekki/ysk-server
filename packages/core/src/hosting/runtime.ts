/**
 * Multi-version Node.js and PHP hosting selection contracts.
 */

import { ErrorCodes, YskError } from '@ysk/shared';

export type RuntimeKind = 'node' | 'php';

export interface RuntimeSelection {
  kind: RuntimeKind;
  version: string;
  /** Absolute path hint for binary on target host */
  binaryPath: string;
  manager: 'nvm' | 'fnm' | 'nodesource' | 'ondrej-php' | 'system';
}

const NODE_SUPPORTED = ['18', '20', '22'] as const;
const PHP_SUPPORTED = ['8.1', '8.2', '8.3'] as const;

/**
 * Select a Node.js runtime version and return install/run plan metadata.
 */
export function selectNodeRuntime(version: string): RuntimeSelection {
  const major = version.replace(/^v/, '').split('.')[0];
  if (!NODE_SUPPORTED.includes(major as (typeof NODE_SUPPORTED)[number])) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      `Unsupported Node.js version ${version}; supported majors: ${NODE_SUPPORTED.join(', ')}`,
      { httpStatus: 400 },
    );
  }
  return {
    kind: 'node',
    version: major,
    binaryPath: `/usr/local/ysk/node/${major}/bin/node`,
    manager: 'fnm',
  };
}

/**
 * Select a PHP runtime version.
 */
export function selectPhpRuntime(version: string): RuntimeSelection {
  const normalized = version.startsWith('php') ? version.slice(3) : version;
  if (!PHP_SUPPORTED.includes(normalized as (typeof PHP_SUPPORTED)[number])) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      `Unsupported PHP version ${version}; supported: ${PHP_SUPPORTED.join(', ')}`,
      { httpStatus: 400 },
    );
  }
  return {
    kind: 'php',
    version: normalized,
    binaryPath: `/usr/bin/php${normalized}`,
    manager: 'ondrej-php',
  };
}

/**
 * Generate PM2 / systemd unit skeleton for a Node project.
 */
export function renderNodeProcessUnit(opts: {
  projectName: string;
  linuxUser: string;
  appDir: string;
  nodeBinary: string;
  entry: string;
  port: number;
}): string {
  return `[Unit]
Description=YSK Server project ${opts.projectName}
After=network.target

[Service]
Type=simple
User=${opts.linuxUser}
WorkingDirectory=${opts.appDir}
Environment=NODE_ENV=production
Environment=PORT=${opts.port}
ExecStart=${opts.nodeBinary} ${opts.entry}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Render Apache VirtualHost + PHP-FPM pool fragment.
 */
export function renderPhpVhost(opts: {
  domain: string;
  docRoot: string;
  phpVersion: string;
  poolName: string;
}): string {
  return `<VirtualHost *:80>
  ServerName ${opts.domain}
  DocumentRoot ${opts.docRoot}
  <Directory ${opts.docRoot}>
    AllowOverride All
    Require all granted
  </Directory>
  <FilesMatch \\.php$>
    SetHandler "proxy:unix:/run/php/php${opts.phpVersion}-fpm-${opts.poolName}.sock|fcgi://localhost"
  </FilesMatch>
  ErrorLog \${APACHE_LOG_DIR}/${opts.poolName}-error.log
  CustomLog \${APACHE_LOG_DIR}/${opts.poolName}-access.log combined
</VirtualHost>
`;
}

export function listSupportedRuntimes(): { node: string[]; php: string[] } {
  return { node: [...NODE_SUPPORTED], php: [...PHP_SUPPORTED] };
}
