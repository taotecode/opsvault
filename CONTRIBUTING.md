# 贡献指南

感谢参与铂尔分（Boerfen Assets）。

## 开发环境

- Node.js ≥ 22，pnpm 10
- Docker（PostgreSQL 双方言测试、容器构建）
- `ssh-keygen`（生成/规范化 SSH 密钥，Linux/macOS 自带；Docker 镜像已包含）

```bash
pnpm install
pnpm --filter @boerfen/shared build
pnpm dev            # server:8080 + web:5173
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

PostgreSQL 测试：

```bash
docker compose --profile pg up -d --wait pg
TEST_POSTGRES_URL=postgres://boerfen:boerfen@127.0.0.1:5432/boerfen_test pnpm -r test
```

## 提交规范

- Conventional Commits：`feat(scope): …`、`fix(scope): …`、`docs:`、`chore:`、`refactor:`、`test:`。
- 变更需带测试或说明为何无法测试。
- 前端组件遵循 `components/ui → components/common → pages` 三层；不要把业务逻辑塞进 ui 原子。
- 不提交 `.env`、`data/`、真实凭据或私钥。

## PR 流程

1. 从 `main` 拉分支（`feat/…`、`fix/…`）。
2. 本地跑全量门禁：typecheck、lint、test、build。
3. 更新 `CHANGELOG.md`（如需）与相关文档。
4. 提交 PR 时描述变更动机、影响面、测试方式与截图（UI 变更）。

## 安全

不要在公开 issue 中粘贴漏洞细节；请参考 [SECURITY.md](SECURITY.md) 的私密披露流程。

## 行为准则

参与即表示同意 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
