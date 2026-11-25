# AGENTS.md · 协作者指南（面向 AI 编码代理）

本仓库由人类与 AI 代理共同维护。任何代理在本仓库工作时遵守以下约定：

## 必读

1. `SPEC.md`：功能与安全契约。
2. `docs/contracts.md`：数据表、API、组件与目录所有权。
3. `preview/index.html`：设计与交互基线（仅参考，不修改）。
4. `GOAL.md`：当前交付目标（历史任务背景）。

## 硬性规则

- 不得修改 `SPEC.md`、`preview/index.html`、`GOAL.md`，除非人类明确要求。
- 凭据、私钥、令牌绝不写入日志、错误信息、测试快照或提交。
- 任何敏感能力（reveal、私钥导出、终端）对 Agent 令牌一律拒绝；不得以任何方式绕过。
- 安装完成后 `/setup` 相关入口必须服务端 404；不得为方便调试恢复入口。
- 组件遵循三层：`components/ui`（shadcn/Radix 原子）→ `components/common`（业务组件）→ `pages`（编排）。页面超过 ~300 行需拆分。
- 优先使用公开组件与库（shadcn/ui、Radix、TanStack、cmdk、Sonner、next-themes、lucide、zxcvbn-ts），不要重复造轮子。
- 新依赖需说明理由，并更新 lockfile。
- 提交遵循 Conventional Commits；变更需附带验证命令与结果。

## 验证门禁

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build
```

涉及 UI 的变更还需提供浅色/深色截图（或 Playwright 证据）；涉及 API 的变更需更新 OpenAPI 目录（`apps/server/src/routes/meta.ts`）与 `llms.txt`。

## 目录所有权（并发开发）

详见 `docs/contracts.md`。并发代理不得同时修改同一文件；共享契约变更由主协调者裁决。
