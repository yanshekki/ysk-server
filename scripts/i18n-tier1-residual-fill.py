#!/usr/bin/env python3
"""Apply Tier-1 residual EN → zh-HK / zh-CN for human UI strings."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path("packages/shared/locales")

# path like "audit.actions.auth.login" → ns=audit, parts=['actions','auth','login']
# Skip pure brands/tokens left as English intentionally
SKIP_KEYS = {
    "agents.labelStderr",  # stderr
    "catalog.sw.fail2ban",
    "catalog.sw.postfix",
    "catalog.sw.dovecot",
    "catalog.sw.opendkim",
    "catalog.sw.pdns_server",
    "catalog.sw.node",
    "catalog.sw.python",
    "catalog.php.opcache",
    "dns.tabs.dnssec",
    "email.deliv.dkim",
    "email.deliv.dmarc",
    "email.probeDkim",
    "email.probeDmarc",
    "email.probeDnsbl",
    "logs.srcFail2ban",
    "logs.srcAuthLog",
    "logs.srcLetsEncrypt",
    "logs.logrotateLabel",
    "nav.node",
    "nav.python",
    "nav.rust",
    "nav.fail2ban",
    "nav.cron",
    "nav.systemd",
    "nav.java",
    "nav.kotlin",
    "network.cidr",
    "network.realip.providers.cloudflare",
    "network.realip.providers.fastly",
    "network.realip.providers.bunny",
    "network.realip.providers.cloudfront",
    "network.realip.providers.azure_frontdoor",
    "network.realip.providers.gcore",
    "nginx.projectPreviewPath",
    "notes.auto.t0299",
    "notes.auto.t0375",
    "projects.runtimeName.node",
    "projects.runtimeName.python",
    "projects.runtimeName.rust",
    "projects.runtimeName.java",
    "projects.runtimeName.kotlin",
    "runtime.phpIniCatalog.groups.opcache.title",
    "runtime.phpIniCatalog.options.sessionMemcached",
    "runtime.phpIniCatalog.options.openBasedirHome",
    "runtime.phpIniCatalog.options.errorLogPhp",
    "runtime.phpIniCatalog.options.errorLogSyslog",
    "software.apply.progressDetail",
    "vnc.stackBins",
    "firewall.profiles.ftps.short",
    "notes.software.npmGlobal",
    "email.writeSsoSkeleton",  # already mixed ZH
}

# English source → (zh-HK, zh-CN)
# Keyed by full dotted path for precision
MAP_HK_CN: dict[str, tuple[str, str]] = {
    "agents.codeComment": (
        "# 概念：register → heartbeat 迴圈 → 拉指令 → ack\n# 函式庫：@ysk/core runOutboundAgent / agentCycle",
        "# 概念：register → heartbeat 循环 → 拉指令 → ack\n# 库：@ysk/core runOutboundAgent / agentCycle",
    ),
    "agents.labelAckCli": ("ack + CLI JSON", "ack + CLI JSON"),
    "audit.actions.protection.change": ("防護設定已變更", "防护设置已更改"),
    "audit.actions.auth.login": ("已登入", "已登录"),
    "audit.actions.auth.logout": ("已登出", "已退出登录"),
    "audit.actions.system.firewall.allow_port": ("防火牆允許埠", "防火墙允许端口"),
    "audit.actions.system.firewall.deny": ("防火牆拒絕 IP", "防火墙拒绝 IP"),
    "audit.actions.system.firewall.apply": ("套用防火牆", "应用防火墙"),
    "audit.actions.project.deploy": ("專案部署", "项目部署"),
    "audit.actions.project.create": ("已建立專案", "已创建项目"),
    "audit.actions.project.delete": ("已刪除專案", "已删除项目"),
    "audit.actions.system.firewall.enable": ("啟用／停用防火牆", "启用/停用防火墙"),
    "audit.actions.system.firewall.delete_rule": ("刪除防火牆規則", "删除防火墙规则"),
    "audit.actions.system.firewall.delete_deny": ("移除永久拒絕 IP", "移除永久拒绝 IP"),
    "audit.actions.db.adminer.apply": ("資料庫瀏覽器專案", "数据库浏览器项目"),
    "audit.actions.project.goLive": ("專案上線", "项目上线"),
    "audit.actions.project.publish": ("發佈 Nginx", "发布 Nginx"),
    "audit.actions.project.suspend": ("暫停專案", "暂停项目"),
    "audit.actions.software.install": ("安裝軟件", "安装软件"),
    "audit.actions.software.update": ("更新軟件", "更新软件"),
    "cli.msg.--root.must.be.a84834": (
        "--root 必須係 public 或 project:<id>\n",
        "--root 必须是 public 或 project:<id>\n",
    ),
    "cli.msg.need.--content.or.4d7001": (
        "需要 --content 或 --file\n",
        "需要 --content 或 --file\n",
    ),
    "cli.msg.need.at.least.7d311a": (
        "至少需要一個 --member HOST[=role][:access]\n",
        "至少需要一个 --member HOST[=role][:access]\n",
    ),
    "cli.msg.action.must.be.ba14c1": (
        "action 必須係 list|add|remove\n",
        "action 必须是 list|add|remove\n",
    ),
    "cli.msg.use.ysk-server.backup.ca67f4": (
        "請用：ysk-server backup control-plane-restore --name ARCHIVE（唔好用 restore --project-id control-plane）\n",
        "请用：ysk-server backup control-plane-restore --name ARCHIVE（不要用 restore --project-id control-plane）\n",
    ),
    "cli.msg.new.domain.requires.986b78": (
        "新網域需要 --ip A.B.C.D（唔好用佔位預設）\n",
        "新域名需要 --ip A.B.C.D（不要用占位默认）\n",
    ),
    "cli.msg.import-sync.prefers.fleet.4d7590": (
        "import-sync 優先用 fleet clusterSync payload；或 --file snapshot.json\n",
        "import-sync 优先使用 fleet clusterSync payload；或 --file snapshot.json\n",
    ),
    "cli.msg.security.control.plane.f59a63": (
        "安全：控制平面綁定公開位址 (0.0.0.0/::)。建議 127.0.0.1 + 反向代理 / UFW。\n",
        "安全：控制平面绑定公开地址 (0.0.0.0/::)。建议 127.0.0.1 + 反向代理 / UFW。\n",
    ),
    "dashboard.executeBadge": ("EXECUTE {{state}}", "EXECUTE {{state}}"),
    "files.webdavClientFinder": ("macOS Finder", "macOS Finder"),
    "files.webdavClientWin": ("Windows", "Windows"),
    "files.publicShareDefaultName": ("下載", "下载"),
    "firewall.profiles.ftps.label": ("Web + FTPS", "Web + FTPS"),
    "logs.vacuum": ("清理（Vacuum）", "清理（Vacuum）"),
    "logs.journalSection": ("Journal", "Journal"),
    "logs.groupJournal": ("Journal", "Journal"),
    "logs.prioWarn": ("warn+", "warn+"),
    "logs.prioInfo": ("info+", "info+"),
    "metrics.uptimeDays": ("{{d}} 日，{{h}}:{{m}}", "{{d}} 天，{{h}}:{{m}}"),
    "metrics.sseHttpError": ("串流 HTTP {{status}}", "流 HTTP {{status}}"),
    "network.linkDown": ("離線", "断开"),
    "projects.runtime": ("執行環境", "运行时"),
    "projects.checklist.deploy": ("部署", "部署"),
    "projects.netConfPreview": ("設定", "配置"),
    "projects.memoryMax": ("MemoryMax", "MemoryMax"),
    "projects.proc_reload": ("重新載入", "重新加载"),
    "protection.eventKind.cloudflare_ua": ("Cloudflare", "Cloudflare"),
    "roles.agent": ("Agent", "Agent"),
    "runtime.pm2.col.interpreter": ("解譯器", "解释器"),
    "runtime.pm2.col.unit": ("Unit", "Unit"),
    "runtime.pm2.col.runtime": ("執行環境", "运行时"),
    "security.passkeyTitle": ("Passkey / WebAuthn", "Passkey / WebAuthn"),
    "security.allowlistTitle": ("允許清單（{{count}}）", "允许列表（{{count}}）"),
    "systemd.managedPathHint": ("dataDir/systemd/ysk-server.service", "dataDir/systemd/ysk-server.service"),
    "systemd.controlRunningHint": ("systemctl is-active = active", "systemctl is-active = active"),
    "users.filterAdmin": ("管理員", "管理员"),
    "users.filterOperator": ("操作員", "操作员"),
    "users.filterViewer": ("檢視者", "查看者"),
    "users.hostTotalsBadge": ("主機合計", "主机合计"),
    "users.roleName.admin": ("管理員", "管理员"),
    "users.roleName.operator": ("操作員", "操作员"),
    "users.roleName.viewer": ("檢視者", "查看者"),
    "users.roleName.agent": ("Agent", "Agent"),
    "vnc.bind.localhostShort": ("localhost", "localhost"),
    "vpn.peersTitle": ("對等端", "对等端"),
    "vpn.qrTitle": ("QR — {{name}}", "二维码 — {{name}}"),
}


def set_path(root: dict, parts: list[str], value: str) -> bool:
    cur = root
    for p in parts[:-1]:
        if p not in cur or not isinstance(cur[p], dict):
            return False
        cur = cur[p]
    leaf = parts[-1]
    if leaf not in cur:
        return False
    cur[leaf] = value
    return True


def apply_lang(lang: str, idx: int) -> int:
    """idx 0=zh-HK, 1=zh-CN"""
    n = 0
    # group by namespace file
    by_ns: dict[str, list[tuple[list[str], str]]] = {}
    for key, pair in MAP_HK_CN.items():
        if key in SKIP_KEYS:
            continue
        parts = key.split(".")
        ns = parts[0]
        by_ns.setdefault(ns, []).append((parts[1:], pair[idx]))

    for ns, items in by_ns.items():
        path = ROOT / lang / f"{ns}.json"
        if not path.exists():
            print("missing", path)
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for parts, val in items:
            if set_path(data, parts, val):
                n += 1
            else:
                print(f"  miss path {ns}." + ".".join(parts))
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return n


def main() -> None:
    a = apply_lang("zh-HK", 0)
    b = apply_lang("zh-CN", 1)
    print(f"zh-HK updated={a} zh-CN updated={b}")


if __name__ == "__main__":
    main()
