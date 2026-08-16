# Feature: Docker

> Language: English | [中文](./docker-ZH.md)

## Purpose

First-class **Docker Engine** control plane on this host — install, start/stop the daemon, manage containers, images, volumes, networks, Compose projects, disk prune, and a safe `daemon.json` subset. Same product rank as Nginx / Apache.

Validator nodes (`/validators`) run as Compose projects named `yskval-*` and deep-link here when Docker is missing.

**Non-goals:** Kubernetes, Swarm, arbitrary Compose YAML upload, `docker build`, `docker exec`, privileged run, Docker Hub login.

## Panel

| Item | Value |
|------|--------|
| Route | `/docker` |
| Nav key | `docker` (section `containers`) |
| Tabs | Overview · Containers · Images · Compose · Volumes · Networks · Prune · Settings · About |
| Capability | `docker.read` · `docker.manage` · `docker.wipe` |
| Install | Ubuntu `docker.io` + `docker-compose-v2` via software catalog (not get.docker.com) |

## CLI

```bash
ysk-server docker status --json
ysk-server docker ps --json
ysk-server docker images --json
ysk-server docker compose ls --json
YSK_EXECUTE=1 ysk-server docker compose rm --project yskval-eth-hoodi-1 --execute --json
YSK_EXECUTE=1 ysk-server docker run --image alpine:3.20 --name demo --execute --json
YSK_EXECUTE=1 ysk-server docker engine start --execute --json
```

Mutations default to dry-run. Real host change needs `YSK_EXECUTE=1` and `--execute`.

## Safety

- Published ports default to `127.0.0.1`
- No `--privileged`, host network, or bind-mount of `/` `/etc` `/root`
- Volume / system prune requires `confirm=PRUNE` and `docker.wipe`
- Stopping `docker.service` stops every container, including validator stacks
