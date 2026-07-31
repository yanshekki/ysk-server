# 檔案與 FTPS

> 語言：中文（香港書面語）| [English](./files-ftp.md)

**面板路由：** `/files`、`/files/public`、`/ftp`、`/ftp/service`  
**CLI：** `files`、`hosting ftps-apply`

## 檔案管理

沙箱根：公用檔案及／或 `project:ID`。操作：list、stat、read、write、mkdir、rm、rename、copy、move、chmod、多檔上傳、垃圾桶、分享、WebDAV token。

```bash
ysk-server files list --root project:UUID --path public --json
ysk-server files read --root project:UUID --path public/index.html --json
ysk-server files write --root project:UUID --path public/hi.txt --content hello
ysk-server files trash list --json
ysk-server files webdav token --json
ysk-server files upload --dir public --file ./local.zip
```

## FTPS

dataDir 內 vsftpd 管理設定；專案 FTP 帳戶；系統服務安裝／套用需 EXECUTE+root。

```bash
ysk-server hosting ftps-apply --domain files.example.com --json
ysk-server hosting ftps-apply --domain files.example.com --install --execute
```

## 誠實邊界

檔案操作不離開設定根路徑。無 EXECUTE 時系統 vsftpd 只停留計劃／written。

## 相關

[projects-ZH.md](./projects-ZH.md) · [../cli/reference-ZH.md](../cli/reference-ZH.md)
