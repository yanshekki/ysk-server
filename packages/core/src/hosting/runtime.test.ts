import { describe, expect, it } from 'vitest';
import {
  defaultProcessCommands,
  defaultRuntimeVersion,
  isProcessRuntime,
  listSupportedRuntimes,
  normalizeRuntimeVersion,
  renderNodeProcessUnit,
  renderPhpVhost,
  renderProcessUnit,
  selectGoRuntime,
  selectNodeRuntime,
  selectPhpRuntime,
  selectPythonRuntime,
  selectRustRuntime,
} from './runtime.js';

describe('multi-version runtimes', () => {
  it('selects supported node and php versions', () => {
    expect(selectNodeRuntime('20').binaryPath).toContain('/20/');
    expect(selectPhpRuntime('8.2').version).toBe('8.2');
    expect(listSupportedRuntimes().node).toContain('20');
    expect(listSupportedRuntimes().python).toContain('3.12');
    expect(listSupportedRuntimes().go).toContain('1.22');
    expect(listSupportedRuntimes().rust).toContain('stable');
  });

  it('selects python go rust', () => {
    expect(selectPythonRuntime('3.12').binaryPath).toContain('python3.12');
    expect(selectGoRuntime('1.22').binaryPath).toContain('/1.22/');
    expect(selectRustRuntime('stable').manager).toBe('rustup');
  });

  it('defaults version by runtime kind (never PHP→20)', () => {
    expect(defaultRuntimeVersion('php')).toBe('8.2');
    expect(defaultRuntimeVersion('node')).toBe('20');
    expect(defaultRuntimeVersion('python')).toBe('3.12');
    expect(defaultRuntimeVersion('go')).toBe('1.22');
    expect(defaultRuntimeVersion('rust')).toBe('stable');
    expect(defaultRuntimeVersion('static')).toBe('');
    expect(normalizeRuntimeVersion('php', '20')).toBe('8.2');
    expect(normalizeRuntimeVersion('php', '8.3')).toBe('8.3');
    expect(normalizeRuntimeVersion('php', undefined)).toBe('8.2');
    expect(normalizeRuntimeVersion('node', undefined)).toBe('20');
    expect(normalizeRuntimeVersion('static', '20')).toBe('');
    expect(normalizeRuntimeVersion('python', '3.11.5')).toBe('3.11');
    expect(normalizeRuntimeVersion('go', 'go1.22.1')).toBe('1.22');
    expect(normalizeRuntimeVersion('rust', undefined)).toBe('stable');
  });

  it('rejects unsupported versions', () => {
    expect(() => selectNodeRuntime('16')).toThrow(/不支援|Unsupported/);
    expect(() => selectPhpRuntime('7.4')).toThrow(/不支援|Unsupported/);
    expect(() => selectPythonRuntime('2.7')).toThrow(/不支援/);
    expect(() => selectGoRuntime('1.18')).toThrow(/不支援/);
  });

  it('marks process runtimes', () => {
    expect(isProcessRuntime('node')).toBe(true);
    expect(isProcessRuntime('python')).toBe(true);
    expect(isProcessRuntime('go')).toBe(true);
    expect(isProcessRuntime('rust')).toBe(true);
    expect(isProcessRuntime('php')).toBe(false);
    expect(isProcessRuntime('static')).toBe(false);
  });

  it('renders process unit and php vhost configs', () => {
    const unit = renderNodeProcessUnit({
      projectName: 'demo',
      linuxUser: 'ysk_demo',
      appDir: '/var/lib/ysk-server/projects/ysk_demo/app',
      nodeBinary: '/usr/local/ysk/node/20/bin/node',
      entry: 'server.js',
      port: 3000,
      memoryMax: '512M',
      cpuQuotaPercent: 50,
      limitNOFILE: 65535,
    });
    expect(unit).toContain('User=ysk_demo');
    expect(unit).toContain('PORT=3000');
    expect(unit).toContain('MemoryMax=512M');
    expect(unit).toContain('CPUQuota=50%');
    expect(unit).toContain('LimitNOFILE=65535');

    const py = renderProcessUnit({
      projectName: 'py',
      linuxUser: 'ysk_py',
      appDir: '/home/py/app',
      execStart: '/home/py/app/venv/bin/python app.py',
      port: 3200,
    });
    expect(py).toContain('ExecStart=/home/py/app/venv/bin/python app.py');

    const vhost = renderPhpVhost({
      domain: 'app.example.com',
      docRoot: '/var/www/app',
      phpVersion: '8.2',
      poolName: 'app',
    });
    expect(vhost).toContain('ServerName app.example.com');
    expect(vhost).toContain('php8.2-fpm');
  });

  it('default process commands', () => {
    expect(defaultProcessCommands('go', {}).build).toContain('go build');
    expect(defaultProcessCommands('rust', { cargoName: 'ysk_app' }).entry).toContain(
      'target/release/ysk_app',
    );
    expect(defaultProcessCommands('python', {}).entry).toBe('main:app');
    expect(defaultProcessCommands('python', {}).execStart).toContain('uvicorn');
    expect(defaultProcessCommands('python', { entry: 'app.py' }).execStart).toContain('python');
    expect(
      defaultProcessCommands('python', { entry: 'mysite.wsgi:application' }).execStart,
    ).toContain('gunicorn');
  });
});
