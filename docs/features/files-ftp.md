# Files & FTPS

> Language: English | [中文](./files-ftp-ZH.md)

**Panel routes:** `/files`, `/files/public`, `/ftp`, `/ftp/service`  
**CLI:** `files`, `hosting ftps-apply`

## File manager

Sandbox roots: public files and/or `project:ID`. Operations: list, stat, read, write, mkdir, rm, rename, copy, move, chmod, multi-upload, trash, shares, WebDAV token.

```bash
ysk-server files list --root project:UUID --path public --json
ysk-server files read --root project:UUID --path public/index.html --json
ysk-server files write --root project:UUID --path public/hi.txt --content hello
ysk-server files trash list --json
ysk-server files webdav token --json
ysk-server files upload --dir public --file ./local.zip
```

## FTPS

vsftpd managed config under dataDir; project FTP accounts; install/apply needs EXECUTE+root for system service.

```bash
ysk-server hosting ftps-apply --domain files.example.com --json
ysk-server hosting ftps-apply --domain files.example.com --install --execute
```

## Honesty

File ops never escape configured roots. System vsftpd without EXECUTE stays plan/written only.

## Related

[projects.md](./projects.md) · [../cli/reference.md](../cli/reference.md)
