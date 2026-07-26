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

  // —— Permission / capability ——
  if (/YSK_EXECUTE|executeEnabled|系統變更權限|Set YSK_EXECUTE|requiresExecute/i.test(raw)) {
    return '伺服器未開啟系統變更權限，無法在管理面板完成此操作';
  }
  if (/need root|requires? root|Run as root|需要.*root|系統管理員權限|isRoot/i.test(raw)) {
    return '需要系統管理員權限才能完成';
  }
  if (/admin only|需要管理員權限|not an admin/i.test(raw)) {
    return '需要管理員權限';
  }
  if (/SANDBOX|sandbox violation|path not allowed|不在允許/i.test(raw)) {
    return '路徑超出允許範圍（沙箱保護）';
  }
  if (/EACCES|permission denied|Permission denied/i.test(raw)) {
    return '權限不足，無法讀寫目標路徑';
  }
  if (/EADDRINUSE|address already in use|port.*in use/i.test(raw)) {
    return '埠已被佔用';
  }
  if (/ENOENT|no such file/i.test(raw) && /dir|path|file/i.test(raw)) {
    return '找不到指定路徑或檔案';
  }

  // —— Validation / not found ——
  if (/^path required$/i.test(raw) || /請指定路徑/.test(raw)) return '請指定路徑';
  if (/files required/i.test(raw)) return '請選擇檔案';
  if (/from and to required/i.test(raw)) return '請指定來源與目標路徑';
  if (/^not found$|^Not found$/i.test(raw) || /resource not found/i.test(raw)) {
    return '找不到資源';
  }
  if (/unknown software|未知軟件/i.test(raw)) return '未知軟件項目';
  if (/Unauthorized|未授權|401/i.test(raw) && /auth|login|token|session/i.test(raw)) {
    return '未授權，請重新登入';
  }
  if (/method not allowed/i.test(raw)) return '不支援此操作方法';
  if (/Project name is required|請填寫專案名稱/i.test(raw)) return '請填寫專案名稱';
  if (/Unsupported PHP version|不支援的 PHP/i.test(raw)) {
    return raw.includes('不支援') ? raw : '不支援的 PHP 版本';
  }
  if (/Unsupported Node/i.test(raw)) {
    return raw.includes('不支援') ? raw : '不支援的 Node.js 版本';
  }
  if (/Invalid|無效/.test(raw) && /version|版本/i.test(raw)) {
    return '版本無效';
  }

  // —— Provisioning honesty ——
  if (/NOT provisioned|not provisioned|尚未建立|尚未套用/i.test(raw)) {
    return '尚未在伺服器建立資源，請確認權限後再於面板重試';
  }
  if (/Install plan has|plan only|Plan only/i.test(raw)) {
    return null;
  }
  if (/written ≠|written !=|written != applied|written !== applied/i.test(raw)) {
    return '已寫入管理檔，但尚未套用到系統';
  }
  if (/executed ≠|executed !=|executed !==/i.test(raw)) {
    return '指令已執行，但不代表服務已對外就緒';
  }

  // —— Nginx / web ——
  if (/nginx -t OK/i.test(raw)) return 'Nginx 設定檢查通過';
  if (/nginx -t failed/i.test(raw)) return 'Nginx 設定檢查失敗';
  if (/nginx -t skipped/i.test(raw)) return '已略過 Nginx 設定檢查（無權限或未安裝）';
  if (/reload nginx|nginx reloaded|nginx reload/i.test(raw)) return '已重載 Nginx';
  if (/nginx.*not (installed|found)/i.test(raw)) return 'Nginx 尚未安裝';

  // —— systemd ——
  if (/Copied \d+ file/i.test(raw)) {
    const m = raw.match(/Copied (\d+)/i);
    return m ? `已複製 ${m[1]} 個設定檔到系統` : '已複製設定檔到系統';
  }
  if (/systemd enabled/i.test(raw)) return '已啟用 systemd 服務';
  if (/systemd enable failed/i.test(raw)) return '無法啟用 systemd 服務（請確認權限）';
  if (/systemctl is-active/i.test(raw)) {
    const m = raw.match(/:\s*(\S+)/);
    return m ? `服務狀態：${m[1]}` : '已檢查服務狀態';
  }
  if (/systemctl not available/i.test(raw)) {
    return '此主機無 systemd 服務管理';
  }
  if (/unit (written|template)/i.test(raw)) return '已寫入 systemd 單元範本';

  // —— Runtime / deploy ——
  if (/CLI binary not found|not on PATH|binary not found/i.test(raw)) {
    return '伺服器尚未安裝對應程式';
  }
  if (/binary on PATH/i.test(raw)) {
    return '已偵測到可執行檔';
  }
  if (/No port assigned|no port|deploy first/i.test(raw)) {
    return '尚未分配埠，請先部署專案';
  }
  if (/spawn failed/i.test(raw)) {
    const m = raw.match(/spawn failed:\s*(.+)/i);
    return m ? `啟動行程失敗：${m[1].slice(0, 120)}` : '啟動行程失敗';
  }
  if (/spawn returned no pid/i.test(raw)) {
    return '啟動行程後未取得行程編號';
  }
  if (/Wrote .+env|Wrote .*keys\)/i.test(raw)) {
    const m = raw.match(/\((\d+)\s*keys?\)/i);
    return m ? `已寫入環境變數（${m[1]} 項）` : '已寫入環境變數';
  }
  if (/User-uploaded certificate/i.test(raw)) {
    return '已登記上傳憑證路徑';
  }
  if (/health (check )?(ok|passed|healthy)/i.test(raw)) return '健康檢查通過';
  if (/health (check )?(fail|unhealthy)/i.test(raw)) return '健康檢查未通過';

  // —— Database / redis ——
  if (/Password must be set via secure/i.test(raw)) {
    return '密碼需由安全管道設定';
  }
  if (/Requires MySQL|MariaDB admin/i.test(raw)) {
    return '需要 MySQL／MariaDB 管理員權限';
  }
  if (/logical DB index|dedicated Redis/i.test(raw)) {
    return 'Redis 以邏輯 DB 編號隔離；更強隔離需獨立實例';
  }
  if (/未安裝 redis-cli|redis-cli not/i.test(raw)) return '未安裝 redis-cli';
  if (/key 不存在|key does not exist|nil/i.test(raw) && /key/i.test(raw)) {
    return '鍵不存在';
  }

  // —— Backup / restic ——
  if (/restic 不在 PATH|restic not (in|on) PATH|apt install restic/i.test(raw)) {
    return 'restic 未安裝（不在 PATH）';
  }
  if (/restic 未啟用/i.test(raw)) return 'restic 未啟用';
  if (/\d+ snapshots?/i.test(raw) && /restic|snapshot/i.test(raw)) {
    const m = raw.match(/(\d+)\s*snapshots?/i);
    return m ? `共 ${m[1]} 個 restic 快照` : raw;
  }
  if (/無效 snapshot|invalid snapshot/i.test(raw)) return '無效的快照 ID';

  // —— DNS ——
  if (/無 cluster peer|no cluster peer/i.test(raw)) return '尚未登記叢集 peer';
  if (/無 \.zone|no \.zone|尚無 zone/i.test(raw)) return '尚無區域檔可推送';
  if (/DNSSEC/i.test(raw) && /generat|key|金鑰/i.test(raw)) {
    return raw.includes('已') ? raw : 'DNSSEC 金鑰操作完成';
  }

  // —— SSL / certbot ——
  if (/certbot.*fail|Let's Encrypt.*fail/i.test(raw)) {
    return 'Let’s Encrypt 申請失敗，請檢查域名解析與 80 埠';
  }
  if (/certificate (issued|saved|stored)/i.test(raw)) {
    return '憑證已簽發並儲存';
  }

  // —— Cron ——
  if (/crontab|cron/i.test(raw) && /install|installed|wrote/i.test(raw)) {
    return '已處理 crontab';
  }

  // —— Generic success / failure English ——
  if (/^ok$/i.test(raw) || /^success$/i.test(raw) || /^done$/i.test(raw)) return '完成';
  if (/^failed$/i.test(raw) || /^error$/i.test(raw)) return '失敗';
  if (/operation (completed|successful)/i.test(raw)) return '操作完成';
  if (/operation failed/i.test(raw)) return '操作失敗';
  if (/timeout|timed out/i.test(raw)) return '操作逾時';
  if (/connection refused/i.test(raw)) return '連線被拒絕';
  if (/network (is )?unreachable/i.test(raw)) return '網路無法連線';

  if (/not found|not installed|unavail/i.test(raw) && isOperatorNoise(raw)) {
    return '伺服器缺少必要元件';
  }
  if (isOperatorNoise(raw)) {
    return null;
  }

  // If still mostly English technical sentence, leave as-is only if short Chinese already mixed
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
  if (!text?.trim()) return '操作失敗';
  return humanizeOperatorNote(text) ?? text.trim();
}
