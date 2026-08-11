# Nginx 站點

> [English](./nginx-sites.md)

## 用途

Nginx **唯一入口** `/nginx`：專案站 + 獨立站同一張表。套用、預覽、全域／站點設定都喺呢度。

## 專案網絡

專案 → 網絡：只改域名／埠。**喺 Nginx 管理** 去套用。

## 設定

- **全域**：gzip、版本號、body 上限、keepalive、access log  
- **站點**：SSL、強制 HTTPS、HSTS、body、CF Real IP、目錄列表  
