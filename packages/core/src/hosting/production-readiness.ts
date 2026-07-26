/**
 * Spec-aligned production readiness probe — honest report, never over-claim.
 * Maps to AI-Secure-Linux-Server-Manager-Spec phases / hosting gates.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { listSupportedRuntimes } from './runtime.js';
import { probeRuntimes } from './runtime-probe.js';
import { probePowerDns } from './powerdns-apply.js';
import { probePm2 } from './pm2-apply.js';

export type ReadinessLevel = 'ready' | 'degraded' | 'missing' | 'unknown';

export interface ReadinessItem {
  id: string;
  category: string;
  title: string;
  level: ReadinessLevel;
  detail: string;
  /** Spec section reference */
  spec?: string;
  fixHint?: string;
}

export interface ProductionReadinessReport {
  product: string;
  generatedAt: string;
  mode: 'production_capable' | 'degraded';
  executeEnabled: boolean;
  isRoot: boolean;
  score: { ready: number; degraded: number; missing: number; total: number };
  items: ReadinessItem[];
  summary: string[];
  /** Honest: false until production_capable and critical hosting gates ready */
  productionReady: boolean;
}

async function hasCmd(host: HostExecutor, bin: string): Promise<boolean> {
  const r = await host.runCommand(['bash', '-c', `command -v ${bin} || true`], {
    timeoutMs: 5_000,
  });
  return Boolean(r.stdout.trim());
}

/**
 * Build full readiness report for operators / install gate.
 */
export async function assessProductionReadiness(input: {
  dataDir: string;
  host: HostExecutor;
  product?: string;
  version?: string;
}): Promise<ProductionReadinessReport> {
  const items: ReadinessItem[] = [];
  const push = (item: ReadinessItem) => items.push(item);
  const host = input.host;
  const executeEnabled = host.executeEnabled();
  const isRoot = host.isRoot();
  const mode = executeEnabled && isRoot ? 'production_capable' : 'degraded';

  push({
    id: 'control-plane',
    category: 'core',
    title: '控制面資料目錄',
    level: existsSync(input.dataDir) ? 'ready' : 'missing',
    detail: input.dataDir,
    spec: '§2.3',
    fixHint: '請確認 dataDir 已建立且程序可寫入',
  });

  push({
    id: 'execute-policy',
    category: 'security',
    title: '系統變更權限',
    level: executeEnabled ? 'ready' : 'degraded',
    detail: executeEnabled
      ? '已開啟系統變更權限'
      : '未開啟系統變更權限（僅寫入控制面設定）',
    spec: '§3.2',
    fixHint: '於伺服器進程開啟系統變更權限（並以管理員執行）',
  });

  push({
    id: 'root',
    category: 'security',
    title: '系統管理員權限',
    level: isRoot ? 'ready' : 'degraded',
    detail: isRoot
      ? '以管理員執行'
      : '非管理員 — useradd／systemd／nginx 系統路徑受限',
    spec: '§4.1',
    fixHint: '以系統管理員權限啟動管理服務',
  });

  const bins: Array<{ id: string; bin: string; title: string; spec: string; critical?: boolean }> =
    [
      { id: 'bin-nginx', bin: 'nginx', title: 'nginx 可執行檔', spec: '§4.7', critical: true },
      { id: 'bin-node', bin: 'node', title: 'node 可執行檔', spec: '§4.2', critical: true },
      { id: 'bin-git', bin: 'git', title: 'git 可執行檔', spec: '§4.2' },
      { id: 'bin-php', bin: 'php', title: 'php 可執行檔', spec: '§4.3' },
      { id: 'bin-python', bin: 'python3', title: 'python3 可執行檔', spec: '§4.2' },
      { id: 'bin-go', bin: 'go', title: 'go 可執行檔', spec: '§4.2' },
      { id: 'bin-cargo', bin: 'cargo', title: 'cargo 可執行檔', spec: '§4.2' },
      { id: 'bin-mysql', bin: 'mysql', title: 'mysql 用戶端', spec: '§4.4' },
      { id: 'bin-psql', bin: 'psql', title: 'psql 用戶端', spec: '§4.4' },
      { id: 'bin-redis', bin: 'redis-cli', title: 'redis-cli', spec: '§4.4' },
      { id: 'bin-openssl', bin: 'openssl', title: 'openssl（信箱雜湊）', spec: '§5' },
      { id: 'bin-postfix', bin: 'postfix', title: 'postfix', spec: '§5' },
      { id: 'bin-dovecot', bin: 'dovecot', title: 'dovecot', spec: '§5' },
      { id: 'bin-certbot', bin: 'certbot', title: 'certbot', spec: '§4.6' },
      { id: 'bin-ufw', bin: 'ufw', title: 'ufw', spec: '§4.9' },
      { id: 'bin-fail2ban', bin: 'fail2ban-client', title: 'fail2ban', spec: '§4.9' },
      { id: 'bin-pdnsutil', bin: 'pdnsutil', title: 'pdnsutil（PowerDNS）', spec: '§4.8' },
    ];

  for (const b of bins) {
    const ok = await hasCmd(host, b.bin);
    push({
      id: b.id,
      category: 'binaries',
      title: b.title,
      level: ok ? 'ready' : b.critical ? 'missing' : 'degraded',
      detail: ok ? `${b.bin} 在 PATH` : `${b.bin} 找不到`,
      spec: b.spec,
      fixHint: ok ? undefined : `請於系統安裝 ${b.bin}，或於面板 runtime／軟件安裝`,
    });
  }

  const runtimes = await probeRuntimes(host);
  const nodeReady = runtimes.node.filter((n) => n.available).map((n) => n.version);
  const phpReady = runtimes.php.filter((p) => p.available).map((p) => p.version);
  const pyReady = runtimes.python.filter((p) => p.available).map((p) => p.version);
  const goReady = runtimes.go.filter((g) => g.available).map((g) => g.version);
  const rustReady = runtimes.rust.filter((r) => r.available).map((r) => r.version);
  push({
    id: 'runtimes-node',
    category: 'hosting',
    title: 'Node 多版本',
    level: nodeReady.length ? 'ready' : 'degraded',
    detail: nodeReady.length
      ? `可用主版本：${nodeReady.join(', ')}`
      : `支援 ${listSupportedRuntimes().node.join(', ')} — 尚未探測到`,
    spec: '§4.2',
    fixHint: '於面板 Node 執行環境安裝目標版本',
  });
  push({
    id: 'runtimes-php',
    category: 'hosting',
    title: 'PHP 多版本',
    level: phpReady.length ? 'ready' : 'degraded',
    detail: phpReady.length
      ? `可用：${phpReady.join(', ')}`
      : `支援 ${listSupportedRuntimes().php.join(', ')} — 尚未探測到`,
    spec: '§4.3',
    fixHint: '於面板 PHP 執行環境安裝目標版本',
  });
  push({
    id: 'runtimes-python',
    category: 'hosting',
    title: 'Python 多版本',
    level: pyReady.length ? 'ready' : 'degraded',
    detail: pyReady.length
      ? `可用：${pyReady.join(', ')}`
      : `支援 ${listSupportedRuntimes().python.join(', ')} — 尚未探測到`,
    spec: '§4.2',
    fixHint: '於面板 Python 執行環境安裝目標版本',
  });
  push({
    id: 'runtimes-go',
    category: 'hosting',
    title: 'Go 多版本',
    level: goReady.length ? 'ready' : 'degraded',
    detail: goReady.length
      ? `可用：${goReady.join(', ')}`
      : `支援 ${listSupportedRuntimes().go.join(', ')} — 尚未探測到`,
    spec: '§4.2',
    fixHint: '於面板 Go 執行環境安裝目標版本',
  });
  push({
    id: 'runtimes-rust',
    category: 'hosting',
    title: 'Rust toolchain',
    level: rustReady.length ? 'ready' : 'degraded',
    detail: rustReady.length
      ? `可用：${rustReady.join(', ')}`
      : `支援 ${listSupportedRuntimes().rust.join(', ')} — 尚未探測到`,
    spec: '§4.2',
    fixHint: '於面板 Rust 執行環境安裝 rustup／cargo',
  });

  const pm2 = await probePm2(host);
  push({
    id: 'pm2',
    category: 'hosting',
    title: 'PM2 行程管理',
    level: pm2.available ? 'ready' : 'degraded',
    detail: pm2.available
      ? `pm2：${pm2.path}`
      : 'pm2 不在 PATH（仍可用 pidfile／systemd）',
    spec: '§4.2',
    fixHint: '可選安裝 pm2：npm i -g pm2',
  });

  const pdns = await probePowerDns(host);
  push({
    id: 'powerdns',
    category: 'dns',
    title: 'PowerDNS 工具',
    level: pdns.available ? 'ready' : 'degraded',
    detail: pdns.notes.join('；') || '未安裝',
    spec: '§4.8',
    fixHint: '於 DNS 功能安裝 PowerDNS 相關套件',
  });

  const webDist = join(process.cwd(), 'apps/web/dist/index.html');
  const webAlt = existsSync(join(input.dataDir, 'web/index.html'));
  push({
    id: 'web-ui',
    category: 'core',
    title: 'Web 介面建置',
    level: existsSync(webDist) || webAlt ? 'ready' : 'degraded',
    detail: existsSync(webDist)
      ? 'apps/web/dist 已存在'
      : webAlt
        ? 'dataDir/web 已存在'
        : '尚未建置 Web 介面 — 僅 API 模式',
    spec: '§3.9',
    fixHint: 'pnpm --filter @ysk/web build',
  });

  push({
    id: 'email-managed',
    category: 'email',
    title: '郵件管理設定目錄',
    level: existsSync(join(input.dataDir, 'email')) ? 'ready' : 'degraded',
    detail: existsSync(join(input.dataDir, 'email'))
      ? 'dataDir/email 已存在'
      : '尚未套用郵件域名',
    spec: '§5',
    fixHint: '建立郵件域名並於詳情頁套用',
  });

  const ready = items.filter((i) => i.level === 'ready').length;
  const degraded = items.filter((i) => i.level === 'degraded').length;
  const missing = items.filter((i) => i.level === 'missing').length;
  const criticalMissing = items.filter(
    (i) => i.level === 'missing' && (i.id === 'bin-nginx' || i.id === 'bin-node' || i.id === 'control-plane'),
  );

  const productionReady =
    mode === 'production_capable' &&
    criticalMissing.length === 0 &&
    items.find((i) => i.id === 'bin-nginx')?.level === 'ready' &&
    items.find((i) => i.id === 'bin-node')?.level === 'ready';

  const summary: string[] = [
    mode === 'production_capable' ? '模式：可生產' : `模式：${mode}`,
    productionReady
      ? '生產門檻：通過（權限、Nginx、Node 就緒）'
      : '生產門檻：尚未完全達標，請查看下方缺項',
    `就緒 ${ready} / 降級 ${degraded} / 缺少 ${missing}（共 ${items.length} 項）`,
  ];
  if (!executeEnabled) {
    summary.push('伺服器未開啟系統變更權限，管理面板無法完成系統層操作');
  }
  if (!isRoot) {
    summary.push('目前非系統管理員權限，部分系統設定無法套用');
  }

  return {
    product: input.product ?? 'YSK Server',
    generatedAt: new Date().toISOString(),
    mode,
    executeEnabled,
    isRoot,
    score: { ready, degraded, missing, total: items.length },
    items,
    summary,
    productionReady,
  };
}
