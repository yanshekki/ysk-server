# 控制平面 systemd

> 語言：中文（香港書面語）| [English](./systemd.md)

## 安裝 unit

```bash
ysk-server system unit-install --enable --execute
```

`setup` 亦會在 `dataDir/systemd/` 寫入範本。

## 提示

- unit 內固定 `--data-dir`／`--config`  
- 盡量用專用系統用戶執行  
- 對外暴露前先強密碼 + 2FA  

## 相關

[../getting-started/setup-ZH.md](../getting-started/setup-ZH.md) · [root-execute-ZH.md](./root-execute-ZH.md)
