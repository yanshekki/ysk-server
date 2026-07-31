# SSH Identity Vault（身份金鑰）

> Language: English | [中文](./ssh-identities-ZH.md)

管理 **SSH 私鑰／出站身份**，與 **登入公鑰**（`authorized_keys` / SFTP keys）分開。

## 心智模型

| 類型 | 問題 | 模組 |
|------|------|------|
| 登入公鑰 | 誰可以 SSH/SFTP 進來？ | `sftp-keys` · `/api/v1/sftp/keys` |
| 身份金鑰 | 這個 Linux user / 面板出去用哪把匙？ | `ssh-identity` · CLI `ssh-key` |

## 存放

```text
{dataDir}/secrets/ssh/
  .master.key       # 0400；或 env YSK_SECRETS_KEY
  identities.json   # meta + privateKeyEnc only
  keys/{id}/…       # panel_outbound install 路徑
```

- 私鑰 **AES-256-GCM** 加密；AAD = identity id  
- List/get **永不**回傳明文 private；`export` / `--reveal` 才解密  
- 備份 `dataDir` 時請一併備份 master key（或保存 `YSK_SECRETS_KEY`）

## CLI

```bash
ysk-server ssh-key list --json
ysk-server ssh-key create --name peer1 --purpose panel --reveal --json
ysk-server ssh-key create --name proj-a --purpose user --user ysks_a --home /var/ysk/projects/… --json
ysk-server ssh-key import --name old --file ./id_ed25519 --purpose panel --json
ysk-server ssh-key public --id UUID
ysk-server ssh-key export --id UUID --out /tmp/id_ed25519
ysk-server ssh-key install --id UUID              # dry-run
ysk-server ssh-key install --id UUID --execute    # 需 YSK_EXECUTE=1
ysk-server ssh-key test --id UUID --target user@host[:port] [--execute]
ysk-server ssh-key rotate --id UUID [--reveal]
ysk-server ssh-key authorize-self --id UUID       # 公鑰 → binding 用戶 authorized_keys
ysk-server ssh-key uninstall --id UUID --execute
ysk-server ssh-key delete --id UUID [--purge-disk]
```

Exit codes 與全域 CLI 契約相同。Install / test 預設 dry-run；`--execute` + `YSK_EXECUTE=1` 才真正連線或寫磁碟。

### 消費端（出站）

```bash
# DB cluster peer scp / probe / install-peers
ysk-server db-cluster push --id CLUSTER --identity SSH_IDENTITY_UUID --execute --json
ysk-server db-cluster probe --id CLUSTER --peers --identity SSH_IDENTITY_UUID --json
ysk-server db-cluster install-peers --id CLUSTER --identity SSH_IDENTITY_UUID --execute --json
```

Backup remote：`backup_remote.identityId`（面板設定）優先於 password；`pushBackupRemote` 會 `scp -i`。

Member 亦可設 `ssh.identityId`（每 peer 不同 key）。

## 狀態

`stored` → `installed` →（可選）`verified`  
`installed ≠` 遠端已授權；需自行把公鑰放到目標 `authorized_keys`，或 `authorize-self` / `test`。

## 安全

- 不要把 private 寫進 audit detail  
- export 應限 admin 並記 audit（HTTP 層）  
- 不自動掃描並接管機器上既有 `~/.ssh/id_*`
