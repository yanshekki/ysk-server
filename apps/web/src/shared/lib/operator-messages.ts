/**
 * Strip shell-homework / internal env slogans from operator-facing text.
 * Panel executes everything — never ask the user to run CLI.
 */

const SHELL_OR_ENV =
  /YSK_EXECUTE|certbot\s|systemctl\s|apt-get\s|apt\sinstall|sudo\s|useradd\s|nginx\s-t|named-checkzone|pdnsutil|mysql\s-e|psql\s|redis-cli|setenv|export\s+YSK|run this|copy (the )?sql|自行執行|請執行|到 terminal|到 shell|SSH|Install plan has|plan only|Plan only|NOT provisioned|bash install|install-roundcube|WORDPRESS_INSTALL|fix:true|download:true|run with --apply/i;

/** True if note looks like CLI homework or internal flags */
export function isOperatorNoise(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (SHELL_OR_ENV.test(t)) return true;
  // multi-line shell-ish
  if (t.includes('\n') && /--\w+/.test(t) && t.split('\n').length <= 6) return true;
  // raw SQL dumps
  if (/^(CREATE |GRANT |ALTER |DROP )/i.test(t)) return true;
  return false;
}

/** Map known English/internal phrases to short Chinese panel messages */
export function humanizeOperatorNote(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;

  // Explicit human mappings first
  if (/YSK_EXECUTE|executeEnabled|系統變更權限|Set YSK_EXECUTE/i.test(raw)) {
    return '伺服器未開啟系統變更權限，無法在管理面板完成此操作';
  }
  if (/need root|requires? root|Run as root|需要.*root|系統管理員權限/i.test(raw)) {
    return '需要系統管理員權限才能完成';
  }
  if (/NOT provisioned|not provisioned|尚未建立|尚未套用/i.test(raw)) {
    return '尚未在伺服器建立資源，請確認權限後再於面板重試';
  }
  if (/Install plan has|plan only|Plan only/i.test(raw)) {
    return null;
  }
  if (/systemctl is-active/i.test(raw)) {
    const m = raw.match(/:\s*(\S+)/);
    return m ? `服務狀態：${m[1]}` : '已檢查服務狀態';
  }
  if (/systemctl not available/i.test(raw)) {
    return '此主機無 systemd 服務管理';
  }
  if (/CLI binary not found|not on PATH/i.test(raw)) {
    return '伺服器尚未安裝對應程式';
  }
  if (/binary on PATH/i.test(raw)) {
    return '已偵測到可執行檔';
  }
  if (/not found|not installed|unavail/i.test(raw) && isOperatorNoise(raw)) {
    return '伺服器缺少必要元件';
  }
  if (isOperatorNoise(raw)) {
    return null;
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
