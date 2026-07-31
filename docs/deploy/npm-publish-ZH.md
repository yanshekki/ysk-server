# npm 發布

> 語言：中文 | [English](./npm-publish.md)

版本升級且 CI 通過後，從 monorepo 發布 `@ysk/*` 套件。

```bash
pnpm -r build
# 按各套件策略 publish
```

自架 git 部署不一定需要 npm 發布。
