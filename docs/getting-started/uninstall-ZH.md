# 解除安裝

> 語言：中文 | [English](./uninstall.md)

以可控方式移除 **YSK Server** 主機堆疊套件（以及可選嘅控制平面產品）。

| 項目 | 說明 |
|------|------|
| 腳本 | 倉庫根目錄 [`uninstall.sh`](../../uninstall.sh) |
| Manifest | `$dataDir/stack-manifest.json`（YSK 裝過咩） |
| 對應 | [`install.sh`](../../install.sh) · [install-ZH.md](./install-ZH.md) |

**誠實原則：** uninstall 只處理 **套件／單元／可選資料路徑**（manifest 有記錄嘅）。唔會聲稱還原所有面板設定檔。除非你刻意要清 DB／郵件資料，否則用 **keep-data**。

---

## 互動式（建議）

```bash
sudo ./uninstall.sh
```

嚮導步驟：

1. **範圍** — 全部已追蹤組件、按 **套餐**、或按 **單件軟件**
2. **資料策略** — `keep-data`（預設）或 `purge-data`
3. **產品** — 是否移除 `ysk-server` CLI／systemd unit
4. **確認** — purge 必須輸入 `yes`

日誌：`/var/log/ysk-server/uninstall-*.log`（root）或 `~/.ysk/logs/`。

---

## 非互動範例

```bash
# 移除郵件堆疊；保留 spool／DB 檔
sudo ./uninstall.sh --bundles email --keep-data --yes

# 只移除 nginx + certbot
sudo ./uninstall.sh --components nginx,certbot --keep-data --yes

# 卸 stack + 產品 CLI／unit；保留資料
# （--all 預設等同 --remove-product，除非加 --keep-product）
sudo ./uninstall.sh --all --keep-data --yes

# 危險：purge 套件 + 白名單資料 + 產品
sudo ./uninstall.sh --all --purge-data --yes
```

| 參數 | 含義 |
|------|------|
| `--all` | `stack-manifest.json` 全部組件 **並** 移除產品 CLI／unit（除非 `--keep-product`） |
| `--bundles LIST` | 按套餐展開組件（唔動 control-plane 基礎） |
| `--components LIST` | 明確組件 id |
| `--keep-data` | `apt remove`；保留資料目錄（預設） |
| `--purge-data` | `apt purge` + 只刪白名單資料路徑 |
| `--remove-product` | 移除 npm CLI／unit；purge 時可刪 `dataDir` |
| `--keep-product` | 配合 `--all`：只卸 stack，保留 CLI／unit |
| `--yes` | 非互動必須 |
| `--data-dir PATH` | manifest 位置 |

---

## 資料策略

| 策略 | 套件 | 單元 | 資料路徑 | 面板 dataDir |
|------|------|------|----------|--------------|
| `keep-data` | `apt remove` | stop/disable | **保留** | 保留 |
| `purge-data` | `apt purge` | stop/disable | **刪除**（白名單） | 僅連 `--remove-product` 先刪 |

**Purge 白名單：** 只接受組件登記且落在 `/var/*`、`/etc/letsencrypt`、`/usr/local/cargo`、`/usr/local/rustup` 嘅路徑。

---

## 重新安裝

```bash
sudo ./install.sh --plan recommended --non-interactive
sudo ./install.sh   # 互動嚮導
```

詳見 [install-ZH.md](./install-ZH.md)。
