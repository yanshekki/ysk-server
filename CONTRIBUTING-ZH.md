# 為 YSK Server 貢獻

> 語言：中文（香港書面語）| [English](./CONTRIBUTING.md)

YSK Server 是**單機** Linux 控制平面。你把它裝在自己操作的機器上。行業產品（salon、交易、地圖……）不屬於本倉庫。

## 議題與討論區

- 已確認錯誤、功能建議、安裝失敗：GitHub Issues（模板在 `.github/ISSUE_TEMPLATE/`）。
- 問題與想法：[GitHub Discussions](https://github.com/yanshekki/ysk-server/discussions)。
- 私人聯絡：[email@ysk.hk](mailto:email@ysk.hk)。
- 不要貼上密碼、OTP／救援碼、API 金鑰，或 `BOOTSTRAP-CREDENTIALS.txt`。

## 開發

```bash
pnpm install && pnpm build
pnpm gates && pnpm docs:bilingual && pnpm test
```

文件地圖：[docs/INDEX-ZH.md](docs/INDEX-ZH.md)。改主機仍是預演，直至 **root** + `YSK_EXECUTE=1`。

## 依賴更新

Dependabot 每週為 pnpm workspace（`ysk-server`、`ysk-server-core`、`ysk-server-shared`、`apps/web`）與 GitHub Actions 開分組的 **minor／patch** PR。安全性更新已在倉庫設定啟用。不要為了合併升級而放寬 CI。主版本仍由人工每週審查 — 做法同 [docs/security/](docs/security/)。

## 安裝 CI

| 何時 | 做什麼 |
|------|--------|
| 每個 PR／推到 `main` | 在 Ubuntu **22.04／24.04／26.04** 容器跑 `scripts/ci-install-smoke.sh`（語法、`--help`、checksum）。 |
| 每週排程 + **Run workflow** | 同一矩陣跑 `install.sh --non-interactive --plan minimal --from-source --no-install-systemd`。 |

`.github/workflows/ci.yml` 的 Gates／Probe SSOT／Build & test 維持不變。`recommended`／`full` 仍應在 VPS 上試（ufw、nginx、SQL）。
