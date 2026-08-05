/**
 * Strip shell-homework / internal env slogans from operator-facing text.
 * Panel executes everything — never ask the user to run CLI.
 * Display strings go through i18n (L4).
 */

import i18n from './i18n';

const SHELL_OR_ENV =
  /YSK_EXECUTE|certbot\s|systemctl\s|apt-get\s|apt\sinstall|sudo\s|useradd\s|nginx\s-t|named-checkzone|pdnsutil|mysql\s-e|psql\s|redis-cli|setenv|export\s+YSK|run this|copy (the )?sql|自行執行|請執行|到 terminal|到 shell|SSH|Install plan has|plan only|Plan only|NOT provisioned|bash install|install-roundcube|WORDPRESS_INSTALL|form:true|download:true|run with --apply/i;

/** True if note looks like CLI homework or internal flags */
export function isOperatorNoise(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (SHELL_OR_ENV.test(t)) return true;
  if (t.includes('\n') && /--\w+/.test(t) && t.split('\n').length <= 6) return true;
  if (/^(CREATE |GRANT |ALTER |DROP )/i.test(t)) return true;
  return false;
}

function tr(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}

/** Detect permission / execute / root blocks across locales + codes (L3/L4). */
export function looksLikeBlockedMessage(text: string): boolean {
  return /YSK_NEED_EXECUTE|YSK_NEED_ROOT|YSK_EXECUTE|requiresExecute|requiresRoot|executeEnabled|Host execute|need root|requires? root|permission denied|權限|权限|系統變更|系统变更|管理員|管理员|無法在管理面板|无法在管理面板|沙箱|sandbox/i.test(
    text,
  );
}

/** Map known English/internal phrases to short localized panel messages */
export function humanizeOperatorNote(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;

  // Already an i18n key (backend honesty keys)
  if (/^(ops|errors|notes|common)\.[a-zA-Z0-9_.]+$/.test(raw)) {
    const out = tr(raw);
    if (out !== raw) return out;
  }

  // —— Permission / capability ——
  if (
    /YSK_NEED_EXECUTE|YSK_EXECUTE|executeEnabled|系統變更權限|系统变更|Set YSK_EXECUTE|requiresExecute|Host execute is off/i.test(
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
  if (/EACCES|permission denied|Permission denied/i.test(raw)) {
    return tr('ops.blocked.panel');
  }
  if (/EADDRINUSE|address already in use|port.*in use/i.test(raw)) {
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

  // —— Nginx ——
  if (/nginx -t OK|設定檢查通過|配置检查通过/i.test(raw)) {
    return tr('notes.nginx.configOk');
  }
  if (/nginx -t failed|設定檢查失敗|配置检查失败/i.test(raw)) {
    return tr('notes.tpl.nginxConfigFailed', { detail: '' });
  }
  if (
    /reload nginx|nginx reloaded|nginx reload|已重載 Nginx|已重载 Nginx/i.test(raw)
  ) {
    return tr('notes.nginx.reloaded');
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

  // Install failure notes — keep localized prefix; do not drop as shell noise
  if (/安裝失敗|安装失败|Install failed/i.test(raw)) {
    const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 280);
    return cleaned || tr('notes.failed');
  }

  if (isOperatorNoise(raw)) {
    return null;
  }

  // Backend already localized via Accept-Language — pass through
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

/** Humanize a single error / block message for display */
export function humanizeOperatorMessage(text: string | null | undefined): string {
  if (!text?.trim()) return i18n.t('common.opFailed');
  return humanizeOperatorNote(text) ?? text.trim();
}
