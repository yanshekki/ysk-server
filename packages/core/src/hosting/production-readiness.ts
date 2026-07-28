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
import { buildProjectIsolationReadinessItems } from './project-isolation-status.js';

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
  /** SPA path for operator to fix (panel deep-link) */
  fixHref?: string;
  /** critical = blocks productionReady or hard fail; optional = nice-to-have */
  severity?: 'critical' | 'recommended' | 'optional';
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
  /** Items that should be fixed first (missing critical + security gates) */
  blockers: ReadinessItem[];
  /** Category order for UI grouping */
  categories: string[];
}

/** Human category labels (UI may re-map) */
export const READINESS_CATEGORY_ORDER = [
  'core',
  'security',
  'binaries',
  'hosting',
  'dns',
  'email',
  'isolation',
  'ops',
] as const;

export function readinessCategoryLabel(cat: string): string {
  const map: Record<string, string> = {
    core: '控制面',
    security: '權限與安全',
    binaries: '系統軟體',
    hosting: '執行環境',
    dns: 'DNS',
    email: '郵件',
    isolation: '專案隔離',
    ops: '運維',
  };
  return map[cat] ?? cat;
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
  /** Optional project list for isolation gate */
  projects?: Array<{
    id: string;
    name: string;
    linuxUser: string;
    homeDir: string;
    osProvisioned: boolean;
  }>;
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
    fixHref: '/system',
    severity: 'critical',
  });

  push({
    id: 'execute-policy',
    category: 'security',
    title: '系統變更權限',
    level: executeEnabled ? 'ready' : 'degraded',
    detail: executeEnabled
      ? '已開啟系統變更權限（YSK_EXECUTE）'
      : '未開啟系統變更權限（僅寫入控制面設定）',
    spec: '§3.2',
    fixHint: '以 root 啟動並設定 YSK_EXECUTE=1（見主機設定／部署文件）',
    fixHref: '/system',
    severity: 'critical',
  });

  push({
    id: 'root',
    category: 'security',
    title: '系統管理員權限',
    level: isRoot ? 'ready' : 'degraded',
    detail: isRoot
      ? '以 root 執行'
      : '非 root — useradd／systemd／nginx 系統路徑受限',
    spec: '§4.1',
    fixHint: '以 root 啟動 ysk-server 服務（systemctl / 控制面 unit）',
    fixHref: '/system/unit',
    severity: 'critical',
  });

  const bins: Array<{
    id: string;
    bin: string;
    title: string;
    spec: string;
    critical?: boolean;
    fixHref?: string;
  }> = [
    {
      id: 'bin-nginx',
      bin: 'nginx',
      title: 'nginx 可執行檔',
      spec: '§4.7',
      critical: true,
      fixHref: '/nginx',
    },
    {
      id: 'bin-node',
      bin: 'node',
      title: 'node 可執行檔',
      spec: '§4.2',
      critical: true,
      fixHref: '/runtimes/node',
    },
    { id: 'bin-git', bin: 'git', title: 'git 可執行檔', spec: '§4.2', fixHref: '/runtimes/node' },
    { id: 'bin-php', bin: 'php', title: 'php 可執行檔', spec: '§4.3', fixHref: '/runtimes/php' },
    {
      id: 'bin-python',
      bin: 'python3',
      title: 'python3 可執行檔',
      spec: '§4.2',
      fixHref: '/runtimes/python',
    },
    { id: 'bin-go', bin: 'go', title: 'go 可執行檔', spec: '§4.2', fixHref: '/runtimes/go' },
    {
      id: 'bin-cargo',
      bin: 'cargo',
      title: 'cargo 可執行檔',
      spec: '§4.2',
      fixHref: '/runtimes/rust',
    },
    {
      id: 'bin-mysql',
      bin: 'mysql',
      title: 'mysql 用戶端',
      spec: '§4.4',
      fixHref: '/databases/mysql/service',
    },
    {
      id: 'bin-psql',
      bin: 'psql',
      title: 'psql 用戶端',
      spec: '§4.4',
      fixHref: '/databases/postgres/service',
    },
    {
      id: 'bin-redis',
      bin: 'redis-cli',
      title: 'redis-cli',
      spec: '§4.4',
      fixHref: '/databases/redis/service',
    },
    { id: 'bin-openssl', bin: 'openssl', title: 'openssl（信箱雜湊）', spec: '§5', fixHref: '/email' },
    { id: 'bin-postfix', bin: 'postfix', title: 'postfix', spec: '§5', fixHref: '/email' },
    { id: 'bin-dovecot', bin: 'dovecot', title: 'dovecot', spec: '§5', fixHref: '/email' },
    { id: 'bin-certbot', bin: 'certbot', title: 'certbot', spec: '§4.6', fixHref: '/ssl' },
    { id: 'bin-ufw', bin: 'ufw', title: 'ufw', spec: '§4.9', fixHref: '/firewall' },
    {
      id: 'bin-fail2ban',
      bin: 'fail2ban-client',
      title: 'fail2ban',
      spec: '§4.9',
      fixHref: '/fail2ban',
    },
    {
      id: 'bin-pdnsutil',
      bin: 'pdnsutil',
      title: 'pdnsutil（PowerDNS）',
      spec: '§4.8',
      fixHref: '/dns',
    },
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
      fixHint: ok ? undefined : `請於系統安裝 ${b.bin}，或於面板軟件／runtime 安裝`,
      fixHref: ok ? undefined : b.fixHref,
      severity: b.critical ? 'critical' : 'optional',
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
    fixHref: nodeReady.length ? undefined : '/runtimes/node',
    severity: 'recommended',
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
    fixHref: phpReady.length ? undefined : '/runtimes/php',
    severity: 'optional',
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
    fixHref: pyReady.length ? undefined : '/runtimes/python',
    severity: 'optional',
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
    fixHref: goReady.length ? undefined : '/runtimes/go',
    severity: 'optional',
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
    fixHref: rustReady.length ? undefined : '/runtimes/rust',
    severity: 'optional',
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
    fixHref: pm2.available ? undefined : '/runtimes/node',
    severity: 'optional',
  });

  const pdns = await probePowerDns(host);
  push({
    id: 'powerdns',
    category: 'dns',
    title: 'PowerDNS 工具',
    level: pdns.available ? 'ready' : 'degraded',
    detail: pdns.notes.join('；') || '未安裝',
    spec: '§4.8',
    fixHint: '於 DNS 頁安裝 PowerDNS 相關套件',
    fixHref: pdns.available ? undefined : '/dns',
    severity: 'optional',
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
    severity: 'recommended',
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
    fixHref: existsSync(join(input.dataDir, 'email')) ? undefined : '/email',
    severity: 'optional',
  });

  // Ops: resource pressure + key service activity (best-effort, never fake ready)
  try {
    const { collectMetrics } = await import('../monitoring/metrics.js');
    const m = collectMetrics('/');
    const diskPct =
      m.disk?.usedRatio != null ? Math.round(m.disk.usedRatio * 100) : null;
    const memPct = Math.round(m.memory.usedRatio * 100);
    push({
      id: 'ops-memory',
      category: 'ops',
      title: '記憶體壓力',
      level: memPct >= 95 ? 'missing' : memPct >= 85 ? 'degraded' : 'ready',
      detail: `使用率約 ${memPct}%（總 ${Math.round(m.memory.total / 1024 / 1024)} MB）`,
      fixHint: memPct >= 85 ? '檢查佔用行程；見主機指標' : undefined,
      fixHref: memPct >= 85 ? '/metrics' : undefined,
      severity: 'recommended',
    });
    push({
      id: 'ops-disk',
      category: 'ops',
      title: '根磁碟空間',
      level:
        diskPct == null
          ? 'unknown'
          : diskPct >= 95
            ? 'missing'
            : diskPct >= 85
              ? 'degraded'
              : 'ready',
      detail:
        diskPct == null
          ? '無法讀取 statfs'
          : `使用率約 ${diskPct}%（${m.disk?.path ?? '/'}）`,
      fixHint: diskPct != null && diskPct >= 85 ? '清理日誌／備份；見主機設定儲存' : undefined,
      fixHref: diskPct != null && diskPct >= 85 ? '/system' : undefined,
      severity: 'recommended',
    });
    push({
      id: 'ops-load',
      category: 'ops',
      title: '系統負載',
      level:
        m.loadavg[0] > m.cpuCount * 3
          ? 'degraded'
          : m.loadavg[0] > m.cpuCount * 2
            ? 'degraded'
            : 'ready',
      detail: `load ${m.loadavg.map((x) => x.toFixed(2)).join(' / ')}（CPU ×${m.cpuCount}）`,
      fixHref: '/metrics',
      severity: 'optional',
    });
  } catch {
    push({
      id: 'ops-metrics',
      category: 'ops',
      title: '主機指標',
      level: 'unknown',
      detail: '無法收集 metrics',
      fixHref: '/metrics',
    });
  }

  // Key unit activity (read-only systemctl)
  for (const unit of [
    { id: 'svc-nginx', name: 'nginx', title: 'nginx 服務', href: '/nginx', critical: true },
    {
      id: 'svc-fail2ban',
      name: 'fail2ban',
      title: 'fail2ban 服務',
      href: '/fail2ban',
      critical: false,
    },
  ] as const) {
    try {
      const st = await host.serviceStatus(unit.name);
      const active = (st.stdout || '').trim() === 'active';
      const binOk = items.find((i) => i.id === `bin-${unit.name === 'fail2ban' ? 'fail2ban' : unit.name}`);
      // if binary missing, skip service check noise — already reported
      if (binOk && binOk.level !== 'ready' && unit.name === 'nginx') {
        push({
          id: unit.id,
          category: 'ops',
          title: unit.title,
          level: 'missing',
          detail: '二進位不在 PATH，服務無法就緒',
          fixHref: unit.href,
          severity: unit.critical ? 'critical' : 'optional',
        });
      } else {
        push({
          id: unit.id,
          category: 'ops',
          title: unit.title,
          level: active ? 'ready' : unit.critical ? 'degraded' : 'degraded',
          detail: active ? 'systemctl is-active: active' : `systemctl is-active: ${(st.stdout || st.stderr || 'inactive').trim()}`,
          fixHint: active ? undefined : `於服務矩陣啟動 ${unit.name}`,
          fixHref: active ? undefined : '/services',
          severity: unit.critical ? 'critical' : 'optional',
        });
      }
    } catch {
      push({
        id: unit.id,
        category: 'ops',
        title: unit.title,
        level: 'unknown',
        detail: '無法探測 systemctl',
        fixHref: '/services',
      });
    }
  }

  // Per-project OS isolation (independent Linux user + /home/ysk-server-{id})
  if (input.projects) {
    for (const item of buildProjectIsolationReadinessItems(input.projects)) {
      if (!item.fixHref && item.level !== 'ready') {
        item.fixHref = '/projects';
      }
      push(item);
    }
  }

  const ready = items.filter((i) => i.level === 'ready').length;
  const degraded = items.filter((i) => i.level === 'degraded').length;
  const missing = items.filter((i) => i.level === 'missing').length;
  const criticalMissing = items.filter(
    (i) =>
      i.level === 'missing' &&
      (i.id === 'bin-nginx' || i.id === 'bin-node' || i.id === 'control-plane'),
  );

  const productionReady =
    mode === 'production_capable' &&
    criticalMissing.length === 0 &&
    items.find((i) => i.id === 'bin-nginx')?.level === 'ready' &&
    items.find((i) => i.id === 'bin-node')?.level === 'ready';

  const blockers = items.filter((i) => {
    if (i.level === 'missing') return true;
    if (i.severity === 'critical' && i.level !== 'ready') return true;
    if (
      (i.id === 'execute-policy' || i.id === 'root') &&
      i.level !== 'ready'
    ) {
      return true;
    }
    return false;
  });

  const summary: string[] = [
    mode === 'production_capable' ? '模式：可生產' : `模式：${mode}`,
    productionReady
      ? '生產門檻：通過（權限、Nginx、Node 就緒）'
      : '生產門檻：尚未完全達標，請查看下方缺項',
    `就緒 ${ready} / 降級 ${degraded} / 缺少 ${missing}（共 ${items.length} 項）`,
    blockers.length
      ? `優先處理 ${blockers.length} 項阻擋：${blockers
          .slice(0, 5)
          .map((b) => b.title)
          .join('、')}${blockers.length > 5 ? '…' : ''}`
      : '無硬阻擋項（仍可能有建議項）',
  ];
  if (!executeEnabled) {
    summary.push('伺服器未開啟系統變更權限，管理面板無法完成系統層操作');
  }
  if (!isRoot) {
    summary.push('目前非系統管理員權限，部分系統設定無法套用');
  }

  const catSet = new Set(items.map((i) => i.category));
  const categories = [
    ...READINESS_CATEGORY_ORDER.filter((c) => catSet.has(c)),
    ...[...catSet].filter((c) => !(READINESS_CATEGORY_ORDER as readonly string[]).includes(c)),
  ];

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
    blockers,
    categories,
  };
}
