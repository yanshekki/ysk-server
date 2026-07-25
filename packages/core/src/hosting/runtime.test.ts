import { describe, expect, it } from 'vitest';
import {
  listSupportedRuntimes,
  renderNodeProcessUnit,
  renderPhpVhost,
  selectNodeRuntime,
  selectPhpRuntime,
} from './runtime.js';

describe('multi-version runtimes', () => {
  it('selects supported node and php versions', () => {
    expect(selectNodeRuntime('20').binaryPath).toContain('/20/');
    expect(selectPhpRuntime('8.2').version).toBe('8.2');
    expect(listSupportedRuntimes().node).toContain('20');
  });

  it('rejects unsupported versions', () => {
    expect(() => selectNodeRuntime('16')).toThrow(/Unsupported/);
    expect(() => selectPhpRuntime('7.4')).toThrow(/Unsupported/);
  });

  it('renders process unit and php vhost configs', () => {
    const unit = renderNodeProcessUnit({
      projectName: 'demo',
      linuxUser: 'ysk_demo',
      appDir: '/var/lib/ysk-server/projects/ysk_demo/app',
      nodeBinary: '/usr/local/ysk/node/20/bin/node',
      entry: 'server.js',
      port: 3000,
    });
    expect(unit).toContain('User=ysk_demo');
    expect(unit).toContain('PORT=3000');

    const vhost = renderPhpVhost({
      domain: 'app.example.com',
      docRoot: '/var/www/app',
      phpVersion: '8.2',
      poolName: 'app',
    });
    expect(vhost).toContain('ServerName app.example.com');
    expect(vhost).toContain('php8.2-fpm');
  });
});
