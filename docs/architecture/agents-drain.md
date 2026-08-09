# agents.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Fleet register / heartbeat / commands | `routes/agents-fleet.ts` | **X3** |
| Agent runtime probe / plan / unit / install | `routes/agents-runtimes.ts` | **X3** |
| Agents dispatcher | `routes/agents.ts` | **X3** |

Dispatch: `fleet → runtimes`.
