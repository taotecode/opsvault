# AGENTS.md · 协作者指南（面向 AI 编码代理）

本仓库由人类与 AI 代理共同维护。任何代理在本仓库工作时遵守以下约定：

## 必读

1. `README.md`：快速开始、测试门禁与 Agent 接入。
2. `docs/architecture.md`：系统架构与数据流。
3. `docs/security.md`：权限矩阵与安全边界。
4. `docs/components.md`：前端分层与组件约定。
5. `docs/decisions.md`：关键架构决策记录。

## 硬性规则

- 凭据、私钥、令牌绝不写入日志、错误信息、测试快照或提交。
- 任何敏感能力（reveal、私钥导出、终端）对 Agent 令牌一律拒绝；不得以任何方式绕过。
- 安装完成后 `/setup` 相关入口必须服务端 404；不得为方便调试恢复入口。
- 组件遵循三层：`components/ui`（shadcn/Radix 原子）→ `components/common`（业务组件）→ `pages`（编排）。页面超过 ~300 行需拆分。
- 优先使用公开组件与库（shadcn/ui、Radix、TanStack、cmdk、Sonner、next-themes、lucide），不要重复造轮子。
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
