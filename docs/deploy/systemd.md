# Control-plane systemd

> Language: English | [中文](./systemd-ZH.md)

## Install unit

```bash
ysk-server system unit-install --enable --execute
```

`setup` also writes a template under `dataDir/systemd/`.

## Tips

- Pin `--data-dir` / `--config` in the unit  
- Run as a dedicated system user when possible  
- Strong admin password + 2FA before exposing beyond loopback  

## Related

[../getting-started/setup.md](../getting-started/setup.md) · [root-execute.md](./root-execute.md)
