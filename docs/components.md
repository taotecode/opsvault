# 前端组件库

## 分层

```
components/ui/*        原子组件（shadcn/ui + Radix）
components/common/*    业务组件（可复用）
pages/*                页面编排（仅组合组件与数据）
```

### ui 原子

| 组件 | 文件 | 说明 |
|---|---|---|
| Button / Input / Textarea | `ui/controls.tsx` | 玻璃样式按钮与表单控件 |
| Modal / Drawer | `ui/modal.tsx` | 基于 Radix Dialog；Drawer 为右侧全高面板 |
| Tabs | `ui/tabs.tsx` | Radix Tabs |
| Switch / Select / Checkbox | `ui/fields.tsx` | Radix 表单控件 |

### common 业务组件

| 组件 | 文件 | 用途 |
|---|---|---|
| GlassPanel | `common/primitives.tsx` | 液态玻璃面板（统一材质） |
| PageHeader | 同上 | 页面标题/副标题/操作区 |
| CopyButton / Callout / EmptyState | 同上 | 通用交互 |
| StatusBadge / EnvBadge / RoleBadge / StrengthBadge / Dot | `common/badges.tsx` | 语义徽章 |
| DataTable | `common/data-table.tsx` | TanStack Table v8 封装 |
| FleetStrip | `common/fleet-strip.tsx` | 舰队状态刻度条（签名元素） |
| StatBand / LoadMeters | `common/stats.tsx` | 统计带与资源条 |
| ConfirmDialog / ReauthDialog | `common/dialogs.tsx` | 删除确认与敏感操作二次验证 |
| HostDrawer / ManualFields | `common/host-drawer.tsx` | 服务器详情抽屉与手动字段 |
| AddHostDialog | `common/host-add-dialog.tsx` | 添加服务器表单（RHF + Zod） |
| CredentialCreateDialog | `common/credential-create-dialog.tsx` | 新建凭据与关联主机 |
| Keypair generate/import/connect/deploy | `common/keypair-*.tsx` | 密钥生成、导入、下载、部署与验证 |

## 约定

- 每个 common 组件必须有类型化 props，并在至少一个页面复用。
- 页面文件 ≤ ~300 行；超出时抽出页面专属组件（例如 `host-drawer.tsx`）。
- 表单优先 react-hook-form + zod（schema 从 `@opsvault/shared` 复用）。
- 所有敏感内容（凭据明文、私钥）只存在于临时 Modal state，不进入 query 缓存；关闭/倒计时结束即清除。
- 视觉：优先使用 `glass-panel`、`btn`、`field`、`badge`、`data-table` 等全局类，不另行定义一套相似样式。
- 图标统一 lucide-react；提示统一 sonner；命令面板 cmdk。
