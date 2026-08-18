/**
 * Strip shell-homework / internal slogans from operator-facing text.
 * Panel executes everything — never dump raw bash / unit paths as the main UI.
 */

import i18n from './i18n';

/** Shell / env / internal homework — never show as primary operator copy */
const SHELL_OR_ENV =
  /YSK_EXECUTE|certbot\s|systemctl\s|apt-get\s|apt\sinstall|sudo\s|useradd\s|nginx\s-t|named-checkzone|pdnsutil|mysql\s-e|psql\s|redis-cli|setenv|export\s+|run this|copy (the )?sql|自行執行|請執行|到 terminal|到 shell|Install plan has|plan only|Plan only|NOT provisioned|bash install|install-roundcube|WORDPRESS_INSTALL|form:true|download:true|run with --apply|CARGO_HOME|RUSTUP_HOME|RUSTUP_TOOLCHAIN|CARGO_BIN|runuser\s|journalctl|daemon-reload|MainPID|is-active=|StartLimit|WantedBy=|ExecStart=|\[Unit\]|\[Service\]/i;

/** Long technical blobs (build scripts, conf include instructions) */
const TECH_BLOB =
  /export\s+PATH=|target\/release|\/var\/lib\/ysk-server\/|\/etc\/nginx\/|\/etc\/systemd\/|include\s+\/var\/lib|Managed configs live|Include them from nginx|ysk rust build:|toolchain \d|retry \+stable|SIGTERM|chown\s|groupadd|usermod|chmod\s|pidfile|fastcgi_pass|unix:\/run\/php/i;

function tr(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}

/** True if note looks like CLI homework, shell dump, or internal noise */
export function isOperatorNoise(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (SHELL_OR_ENV.test(t)) return true;
  if (t.length > 220 && TECH_BLOB.test(t)) return true;
  if (/^export\s+/i.test(t)) return true;
  if (/^建置\s*[：:]\s*export/i.test(t) || /^build\s*[：:]\s*export/i.test(t)) return true;
  if (/Managed configs live|Include them from nginx|管理設定目錄|管理配置目录|Managed config dir/i.test(t))
    return true;
  if (/include\s+\/.*\/\*\.conf|於 Nginx 加入|在 Nginx 加入|In nginx:\s*include/i.test(t))
    return true;
  if (/^#\s/.test(t) && t.includes('/')) return true;
  if (t.includes('\n') && /--\w+/.test(t) && t.split('\n').length <= 6) return true;
  if (/^(CREATE |GRANT |ALTER |DROP )/i.test(t)) return true;
  // Pure path dump
  if (/^\/[\w./-]+$/.test(t) && t.length > 24) return true;
  if ((t.match(/npm notice/gi) || []).length >= 2) return true;
  return false;
}

/** Detect permission / execute / root blocks across locales + codes */
export function looksLikeBlockedMessage(text: string): boolean {
  const t = text.trim();
  if (/真正推送需|預覽試行|needs? --execute|pass execute=true/i.test(t)) return false;
  return /YSK_NEED_EXECUTE|YSK_NEED_ROOT|YSK_EXECUTE|requiresExecute|requiresRoot|executeEnabled|Host execute is off|need root|requires? root|permission denied|無法在管理面板|无法在管理面板|未開啟系統變更權限|系統變更權限未開|沙箱|sandbox/i.test(
    t,
  );
}

/**
 * Classify note importance for progressive disclosure.
 * - primary: short human summary (always shown, capped)
 * - technical: paths / unit health / diagnostics (collapsed by default)
 * - drop: pure noise
 */
export type OpsNoteKind = 'primary' | 'technical' | 'drop';

export function classifyOpsNote(text: string): OpsNoteKind {
  const raw = text.trim();
  if (!raw) return 'drop';
  if (isOperatorNoise(raw)) return 'drop';
  // Bind / port-in-use diagnostics must stay on the result card (not collapsed).
  if (
    /Unable to bind|Address already in use|0\.0\.0\.0:53|:53\b|埠被佔用|端口被占用|無法綁定|无法绑定|pdnsBindConflict/i.test(
      raw,
    )
  ) {
    return 'primary';
  }
  // Explicit technical diagnostics
  if (
    /systemd|unit|MainPID|is-active|203\/EXEC|pidfile|journalctl|conf\.d|已寫入系統服務|已写入系统服务|已複製\d+|已复制\d+|Managed configs|Include them|管理設定目錄|管理配置目录|ysk-web group|chown|擁有者|拥有者|隔離模式|隔离模式|以專案用戶|以项目用户|已送 SIGTERM|已套用面板|已套用.*調校|已套用.*调校|類型：|类型：|php-proxy|fpm/i.test(
      raw,
    )
  ) {
    // Keep short human status as primary even if it mentions systemd lightly
    if (
      /健康檢查|健康检查|health\s*ok|已重載|已重载|reloaded|建置完成|构建完成|build\s*(ok|done|complete)|進程已啟動|进程已启动|deployed|Certificate|DNS|失敗|失败|failed|error/i.test(
        raw,
      ) &&
      raw.length < 100
    ) {
      return 'primary';
    }
    return 'technical';
  }
  if (raw.length > 160) return 'technical';
  if (/^\/[\w./-]+/.test(raw) && raw.includes('/ysk')) return 'technical';
  return 'primary';
}

/** Map known phrases to short localized panel messages */
export function humanizeOperatorNote(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;

  if (/^(ops|errors|notes|common)\.[a-zA-Z0-9_.]+$/.test(raw)) {
    const out = tr(raw);
    if (out !== raw) return out;
  }

  // —— Permission / capability (off now — not “will need execute to apply”) ——
  if (/真正推送需|預覽試行|needs? --execute|pass execute=true/i.test(raw)) {
    /* keep instructional note */
  } else if (
    /YSK_NEED_EXECUTE|YSK_EXECUTE=|Set YSK_EXECUTE|Host execute is off|executeEnabled.{0,12}false|未開啟系統變更權限|系統變更權限未開|無法[^。]{0,24}系統變更權限/i.test(
      raw,
    )
  ) {
    return tr('ops.blocked.needExecute');
  }
  if (
    /YSK_NEED_ROOT|need root|requires? root|Run as root|需要.*root|系統管理員權限|isRoot/i.test(
      raw,
    )
  ) {
    return tr('ops.blocked.needRoot');
  }
  if (/admin only|需要管理員權限|需要管理员权限|not an admin/i.test(raw)) {
    return tr('notes.needAdmin');
  }
  if (/SANDBOX|sandbox violation|path not allowed|不在允許|不在允许/i.test(raw)) {
    return tr('ops.blocked.writeOutsideDataDir');
  }
  if (/permission denied \(publickey|publickey,password\)/i.test(raw)) {
    return tr('notes.backup.sshAuthFailed');
  }
  if (/EACCES|permission denied|Permission denied/i.test(raw) && !/publickey/i.test(raw)) {
    return tr('ops.blocked.panel');
  }
  if (/EADDRINUSE|address already in use|port.*in use/i.test(raw)) {
    if (/bind|0\.0\.0\.0:53|:53\b|pdns|PowerDNS|埠被佔用|端口被占用/i.test(raw)) {
      return raw.length > 200 ? raw.slice(0, 180).trim() + '…' : raw;
    }
    return tr('notes.tpl.failedDetail', { detail: 'EADDRINUSE' });
  }
  if (/ENOENT|no such file/i.test(raw) && /dir|path|file/i.test(raw)) {
    return tr('notes.fileMissing');
  }

  // —— Validation / not found ——
  if (/^path required$/i.test(raw) || /請指定路徑|请指定路径/.test(raw)) {
    return tr('notes.needPath');
  }
  if (/files required|from and to required/i.test(raw)) {
    return tr('notes.files.needSrcDst');
  }
  if (/^not found$|^Not found$/i.test(raw) || /resource not found/i.test(raw)) {
    return tr('errors.YSK_NOT_FOUND');
  }
  if (
    /Unauthorized|未授權|未授权|401/i.test(raw) &&
    /auth|login|token|session/i.test(raw)
  ) {
    return tr('errors.http.unauthorized');
  }
  if (/Project name is required|請填寫專案名稱|请填写项目名称/i.test(raw)) {
    return tr('notes.needProjectName');
  }

  // —— Provisioning honesty ——
  if (
    /written ≠|written !=|written != applied|written !== applied|已寫入管理檔|已写入管理/i.test(
      raw,
    )
  ) {
    return tr('common.writtenOnly');
  }

  // —— Deploy / process (short labels) ——
  if (/^建置完成|^构建完成|build\s*(complete|ok|done)|編譯完成|编译完成/i.test(raw)) {
    return tr('opsResult.stepBuildOk');
  }
  if (/健康檢查通過|健康检查通过|Health OK|health\s*ok|HTTP\s*2\d\d/i.test(raw) && raw.length < 80) {
    return tr('opsResult.stepHealthOk');
  }
  if (/進程已啟動|进程已启动|pid=\d+|pid\s+\d+/i.test(raw) && raw.length < 120) {
    return tr('opsResult.stepProcessStarted');
  }
  if (
    /systemd unit (唔健康|不健康)|unit not healthy|203\/EXEC|is-active=inactive/i.test(raw)
  ) {
    return tr('opsResult.stepSystemdFallback');
  }
  if (/All agent tool calls must pass YSK Allowlist/i.test(raw)) {
    return tr('agents.noteAllowlist');
  }
  if (/Agent role RBAC capped at write-low/i.test(raw)) {
    return tr('agents.noteRbacCap');
  }
  if (/ExecStart uses real CLI|silent placeholder/i.test(raw)) {
    return null;
  }
  if (/已重載 Nginx|已重载 Nginx|nginx reloaded|nginx reload/i.test(raw)) {
    return tr('notes.nginx.reloaded');
  }
  if (/nginx -t OK|設定檢查通過|配置检查通过|Nginx設定檢查通過|Nginx设定检查通过/i.test(raw)) {
    return tr('notes.nginx.configOk');
  }
  if (/nginx -t failed|設定檢查失敗|配置检查失败/i.test(raw)) {
    return tr('notes.tpl.nginxConfigFailed', { detail: '' });
  }
  if (/已寫入 Nginx|已写入 Nginx|nginx conf|反代|proxy conf/i.test(raw) && raw.length < 160) {
    return tr('opsResult.stepNginxWritten');
  }
  if (/已複製\s*\d+|已复制\s*\d+|copied\s+\d+/i.test(raw)) {
    return tr('opsResult.stepConfigsSynced');
  }
  if (/^運行時\s*[：:]|^运行时\s*[：:]|runtime\s*[：:]/i.test(raw) && raw.length < 100) {
    // Drop — facts strip already shows port/status
    return null;
  }
  if (/^隔離模式|^隔离模式|isolation mode/i.test(raw)) {
    return null;
  }
  if (/^以專案用戶|^以项目用户|runuser/i.test(raw) && raw.length < 80) {
    return null;
  }
  if (/^建置\s*[：:]|^构建\s*[：:]|^build\s*[：:]/i.test(raw) && /export |CARGO_|cargo /i.test(raw)) {
    return null; // raw shell build line
  }
  if (/已送 SIGTERM|SIGTERM/i.test(raw)) {
    return tr('opsResult.stepStoppedOld');
  }
  if (/已變更擁有者|已变更拥有者|chown/i.test(raw)) {
    return null; // technical
  }
  if (/ysk-web group/i.test(raw)) {
    return null;
  }
  if (/已套用面板.*調校|已套用面板.*调校|runtime tuning/i.test(raw)) {
    return tr('opsResult.stepTuningApplied');
  }
  if (/已寫入系統服務|已写入系统服务|systemd.*unit|ysk-project-.*\.service/i.test(raw)) {
    return tr('opsResult.stepUnitWritten');
  }
  if (/系統控制啟動失敗|系统控制启动失败|enable --now failed/i.test(raw)) {
    return tr('opsResult.stepSystemdStartFailed');
  }

  // —— Generic ——
  if (/^ok$/i.test(raw) || /^success$/i.test(raw) || /^done$/i.test(raw)) {
    return tr('notes.tpl.success');
  }
  if (/^failed$/i.test(raw) || /^error$/i.test(raw)) {
    return tr('notes.failed');
  }
  if (/timeout|timed out|逾時|超时/i.test(raw)) {
    return tr('common.opFailed');
  }

  if (/安裝失敗|安装失败|Install failed/i.test(raw)) {
    const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 280);
    return cleaned || tr('notes.failed');
  }

  if (isOperatorNoise(raw)) {
    return null;
  }

  // Soft-trim very long free text
  if (raw.length > 200) {
    return raw.slice(0, 180).trim() + '…';
  }

  return raw;
}

export function sanitizeOperatorNotes(notes: string[] | undefined | null): string[] {
  if (!notes?.length) return [];
  const out: string[] = [];
  for (const n of notes) {
    const h = humanizeOperatorNote(String(n));
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

export type PresentedOpsNotes = {
  /** Short bullets always visible (max ~6) */
  summary: string[];
  /** Diagnostics / paths — collapsed by default */
  technical: string[];
};

/**
 * Split ops notes for progressive disclosure UI.
 */
export function presentOpsNotes(notes: string[] | undefined | null): PresentedOpsNotes {
  if (!notes?.length) return { summary: [], technical: [] };
  const summary: string[] = [];
  const technical: string[] = [];
  const seen = new Set<string>();

  for (const raw of notes) {
    const kind = classifyOpsNote(String(raw));
    if (kind === 'drop') continue;
    const h = humanizeOperatorNote(String(raw));
    if (!h || seen.has(h)) continue;
    seen.add(h);
    if (kind === 'technical') {
      technical.push(h.length > 240 ? h.slice(0, 220) + '…' : h);
    } else {
      summary.push(h);
    }
  }

  // Cap primary list; overflow → technical
  const MAX_SUMMARY = 6;
  if (summary.length > MAX_SUMMARY) {
    technical.unshift(...summary.splice(MAX_SUMMARY));
  }

  return { summary, technical };
}

/** Humanize a single error / block message for display */
export function humanizeOperatorMessage(text: string | null | undefined): string {
  if (!text?.trim()) return i18n.t('common.opFailed');
  return humanizeOperatorNote(text) ?? text.trim().slice(0, 200);
}
