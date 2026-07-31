# Projects & deploy

> Language: English | [中文](./projects-ZH.md)

**Panel routes:** `/projects`, `/projects/:id`  
**CLI:** `projects`, `templates`, `hosting`, `nginx`

## What it does

Create and run multiple sites on one host. Each project has runtime, domain, home/linux user (when provisioned), env, logs, and deploy path.

| Runtime | Deploy path |
|---------|-------------|
| Node | systemd unit → PM2 → pidfile fallback |
| PHP | PHP-FPM + nginx, or `php -S` degraded |
| static | nginx `root` + try_files |

## Panel workflow

1. Create project (name, domain, runtime).  
2. **Network** tab: domain, publish nginx (optional SSL).  
3. **Deploy**: start process / FPM / static.  
4. Git deploy or file upload as needed.  
5. Isolation: provision OS user when ready.

## CLI

```bash
ysk-server projects list --json
ysk-server projects create --name demo --domain demo.local --runtime node
ysk-server projects deploy --id UUID --execute --json
ysk-server projects git-deploy --id UUID --ref main --execute
ysk-server projects isolation list
ysk-server projects isolation provision --id UUID
ysk-server templates list
```

## Honesty

| Without EXECUTE / root | With EXECUTE + root |
|------------------------|---------------------|
| dataDir unit/ecosystem **written** | systemd install, live process |
| nginx conf under dataDir | system conf.d reload possible |
| health may fail | real listen + health |

## Related

[dns-ssl-nginx.md](./dns-ssl-nginx.md) · [runtimes.md](./runtimes.md) · [../deploy/isolation.md](../deploy/isolation.md) · [../cli/reference.md](../cli/reference.md)
