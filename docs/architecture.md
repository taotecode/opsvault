# 架构

## 总览

```
┌────────────────────────────────────────────┐        ┌─────────────────────────────────────────────┐
│ apps/web (React 19 + Vite + Tailwind 4)    │  HTTP  │ apps/server (Fastify 5)                      │
│  ├─ Liquid Glass 设计系统 / shadcn(ui)      │◄──────►│  ├─ REST /api/v1（OpenAPI 3.1 + Scalar）     │
│  ├─ components/common（业务组件）           │  WS    │  ├─ Auth（会话 Cookie + Bearer + RBAC）       │
│  ├─ pages（只编排）                         │◄──────►│  ├─ Vault（AES-256-GCM 信封加密）             │
│  └─ xterm.js Web 终端                       │        │  ├─ Probe 引擎（ssh2 + 解析器）               │
└────────────────────────────────────────────┘        │  ├─ Terminal 网关（ssh2 → WebSocket）         │
                                                      │  ├─ MCP /mcp（Streamable HTTP）              │
        packages/shared                               │  ├─ Setup 安装向导与锁定                       │
  Zod schema · 常量 · 错误码                           │  ├─ 审计 / 设置 / 版本与升级检查               │
                                                      │  └─ 静态托管 web 构建产物                      │
                                                      └───────────────┬─────────────────────────────┘
                                                                      │
                                                     SQLite（默认）/ PostgreSQL 16+（Kysely）
                                                     MASTER_KEY（环境变量或 data/master.key 0600）
```

## 关键设计

### 数据库双方言

- Kysely 作为统一查询层，`db/types.ts` 定义共享表结构。
- 迁移统一使用 `text/integer` 类型、ISO 时间文本，保证 SQLite 与 PostgreSQL 均可执行；迁移位于 `apps/server/src/db/database.ts`。
- 启动时做连接校验、自动迁移；CI 与本地验收分别在 SQLite 与 PostgreSQL 上跑同一套集成测试。

### 认证与权限

- 浏览器：`bf_session`（HttpOnly）+ `bf_csrf`（可读）双提交 CSRF；会话令牌仅存 SHA-256 哈希，可吊销。
- API/Agent：`Authorization: Bearer wfv_…`，仅存哈希，scope 白名单；Agent 令牌默认只读。
- RBAC：admin / operator / viewer；Agent 令牌在敏感能力（reveal、私钥、终端）上一律 403。

### 凭据与密钥

- 信封加密：每条凭据随机 DEK，DEK 由 MASTER_KEY（AES-256-GCM）加密；数据表只存密文。
- reveal 需要登录会话且在 5 分钟二次验证窗口内；审计记录到 `audit_logs`。
- 密钥生成调用系统 `ssh-keygen`（OpenSSH 格式，ssh2 可直接使用）；导入支持 OpenSSH 私钥与 RSA PKCS#1，Ed25519 PKCS#8 会给出明确提示；带口令私钥通过 `ssh-keygen -p` 去口令后重新加密存储。
- 密钥私钥仅在生成时返回一次；后续导出需二次验证。快速连接命令只含地址/端口/用户名。

### 探测与终端

- 探测脚本为固定只读白名单；每段输出以 `@@KEY@@` 分隔，解析器逐段容错并产出 partial 列表。
- SSH 主机密钥 TOFU：首连记录指纹，后续不匹配即拒绝（防 MITM）。
- WebSocket 终端在前置认证钩子通过后建立 ssh2 shell；会话开始/结束写审计。

### 安装与升级

- 首启无管理员时打印一次性 Setup Token；`/setup` 流程通过后写入 `data/install.lock`，所有 setup 路由服务端 404。
- 可选环境变量非交互安装；CLI `reset-install` 仅限服务器执行。
- 版本检查通过 GitHub Releases（可关闭/可 mock）；升级脚本 `scripts/upgrade.sh` 校验 SHA256 后迁移并切换版本，失败回滚。

### 前端组件体系

- `components/ui`：shadcn/ui + Radix 原子（Button/Input/Modal/Tabs/Switch/Select/Checkbox）。
- `components/common`：GlassPanel、PageHeader、StatBand、FleetStrip、LoadMeters、DataTable、StatusBadge、Secret/Reauth 对话框等。
- `pages`：仅编排查询、状态与布局；页面 ≤ ~300 行。
- 视觉：iOS 液态玻璃（半透明面板 + 极光背景 + 镜面高光），明暗主题，移动端响应式；登录/安装页使用 `liquid-glass-react`，应用内面板使用 CSS 玻璃层（可平滑回退）。

### Agent 接入

- OpenAPI 提供稳定 operationId 与 `x-safety`；`/llms.txt` 面向模型阅读；MCP 暴露 10+ 只读/受控写工具；官方 Skill 封装 curl 调用。
- 所有 Agent 调用进入审计（actor_kind=agent）。
