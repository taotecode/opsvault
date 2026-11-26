# OpsVault

> 自托管、开源的服务器资产管理与凭据金库：资产台账 + SSH 自动探测 + Web 终端 + 凭据加密 + 密钥全生命周期 + 团队权限 + **AI/Agent 原生接入**。
> 单容器交付，SQLite 零依赖起步，生产可切换 PostgreSQL。

- 前端：React 19 + Vite + Tailwind CSS 4 + shadcn/ui（Radix）+ iOS 液态玻璃设计（明暗双主题）
- 后端：Node.js 22 + Fastify 5 + Kysely（SQLite / PostgreSQL）+ ssh2 + AES-256-GCM
- Agent：REST + OpenAPI 3.1 + llms.txt + MCP（Streamable HTTP）+ 官方 Skill
- 开源：MIT；完整 CI / Release / Docker / 文档

## 功能

- **资产台账**：主机、环境、分组、标签、到期提醒、手动字段（带宽/流量/计费/成本/供应商）
- **自动探测**：SSH 采集 OS/内核/CPU/内存/磁盘/网卡/IP/负载/虚拟化/Docker；快照与差异；TOFU 主机指纹
- **凭据金库**：密码/私钥/令牌/证书；AES-256-GCM 信封加密；二次验证后查看（10s 自动隐藏）；密码生成器
- **密钥全链路**：生成（Ed25519/RSA-4096）与导入（OpenSSH/PKCS#1）；下载（私钥需二次验证）；快速连接命令；逐主机可用性检测；部署 authorized_keys；仅公钥条目支持
- **Web 终端**：xterm.js + WebSocket + ssh2，会话审计
- **用户与安全**：邀请制、三角色、TOTP 2FA、会话/令牌哈希、CSRF、限流、Helmet/CSP、全量审计
- **平台设置**：探测计划（每小时/每日）、并发/超时/快照保留、登录失败锁定、二次验证窗口、Webhook 测试、数据导出、审计清理、MASTER_KEY 状态与轮换 CLI
- **在线安装**：安装向导 + 一次性 Setup Token；安装后 `/setup` 与安装 API 永久 404；非交互安装与 CLI 重置
- **在线升级**：GitHub Releases + GHCR；版本历史；Docker 引导升级 / 裸机 `upgrade.sh`（SHA256、迁移、回滚）
- **Agent 原生**：Agent 令牌默认只读；reveal/私钥/终端永不开放（403）；MCP 10+ 工具；官方 Skill；机器可读状态（`/setup/status`、`/system/updates`、`/meta`、`/llms.txt`）

## 界面

![仪表盘（深色）](docs/screenshots/dashboard-dark.png)

| 服务器资产 | 密钥对与快速连接 |
| --- | --- |
| ![服务器](docs/screenshots/hosts-dark.png) | ![密钥对](docs/screenshots/keypairs-dark.png) |
| **Web 终端** | **API 与 Agent 接入** |
| ![终端](docs/screenshots/terminal-dark.png) | ![API](docs/screenshots/api-dark.png) |

更多截图：[凭据保险库](docs/screenshots/credentials-dark.png) · [用户与角色](docs/screenshots/users-dark.png) · [审计日志](docs/screenshots/audit-dark.png) · [设置](docs/screenshots/settings-dark.png) · [浅色主题](docs/screenshots/dashboard-light.png) · [移动端](docs/screenshots/dashboard-mobile.png) · [登录](docs/screenshots/login-dark.png)

## 快速开始（Docker，推荐）

```bash
cp .env.example .env
# 可选：设置 MASTER_KEY（base64 32B）以便备份/迁移
docker compose up -d --build
docker compose logs app | head -20   # 查看一次性 Setup Token
```

打开 `http://localhost:8080/setup`，输入控制台打印的 Setup Token，完成数据库选择与管理员创建。安装完成后安装入口自动关闭（404）。

生产建议：

```bash
# 使用 PostgreSQL（compose pg profile）；POSTGRES_PASSWORD 必填
export POSTGRES_PASSWORD="$(openssl rand -base64 24)"
docker compose --profile pg up -d pg
DB_DRIVER=postgres DATABASE_URL="postgres://opsvault:${POSTGRES_PASSWORD}@pg:5432/opsvault" docker compose up -d app
```

## 本地开发

```bash
pnpm install
pnpm --filter @opsvault/shared build
pnpm dev
# 后端 http://localhost:8080（首次启动控制台打印 Setup Token）
# 前端 http://localhost:5173（代理 /api 与 /mcp）
```

构建与单机运行：

```bash
pnpm --filter @opsvault/web build
pnpm --filter @opsvault/server build
pnpm start
```

## 测试与质量

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test                  # SQLite 集成（默认）
TEST_POSTGRES_URL=postgres://opsvault:opsvault@127.0.0.1:5432/opsvault_test \
  pnpm --filter @opsvault/server test   # PostgreSQL 双方言
```

验收要求：SQLite 与 PostgreSQL 均需通过；安装锁定、Agent reveal 403、私钥导出二次验证、密钥导入/连接命令/可用性检测、MCP `initialize/tools/list`、llms.txt、OpenAPI 合法性均在测试中覆盖。

## Agent 接入

1. 创建 **Agent 令牌**（管理员 → API 与 Agent → 新建令牌，勾选所需 scope；默认只读）。
2. 阅读 `/llms.txt`（仓库根与站点均提供），OpenAPI 在 `/api/v1/openapi.json`，人类文档在 `/api/docs`。
3. MCP：`POST /mcp`（Streamable HTTP，Bearer 令牌），工具包括 `hosts_list`、`host_get`、`hosts_search`、`hosts_create`、`hosts_update`、`host_probe`、`credentials_list_meta`、`keypairs_list`、`keypairs_connect_command`、`audit_list`、`system_version`。
4. 官方 Skill：`skills/opsvault/`（`SKILL.md` + `scripts/api.sh`）：

```bash
cp -r skills/opsvault ~/.claude/skills/
export OPSVAULT_BASE_URL=http://localhost:8080
export OPSVAULT_API_TOKEN=ovt_...
scripts/api.sh hosts list --env prod
```

**安全边界**：Agent 令牌无法调用凭据 reveal、私钥导出、Web 终端（403）；所有 Agent 调用写入审计。

## 安全

- 凭据/私钥 AES-256-GCM 信封加密；密码 Argon2id。
- 会话与 API 令牌仅存哈希；写请求 CSRF 双提交；登录/安装限流。
- SSH 主机密钥 TOFU，指纹变化拒绝连接。
- 安装入口一次性 Token + 安装锁；重装仅限服务器 CLI。
- 漏洞披露请使用 GitHub Security Advisories（见 [SECURITY.md](SECURITY.md)）。

## 项目结构

```
apps/server     Fastify API、探测引擎、Web 终端、MCP、安装与升级
apps/web        React SPA（液态玻璃设计系统）
packages/shared Zod schema、常量、错误码
skills/         Claude Skill（api.sh 封装）
docs/           架构、安全、部署、安装、升级、API、Agent、组件
```

## 文档

[架构](docs/architecture.md) · [安全模型](docs/security.md) · [部署](docs/deployment.md) · [安装向导](docs/install.md) · [在线升级](docs/upgrade.md) · [API](docs/api.md) · [Agent 接入](docs/agent-integration.md) · [组件库](docs/components.md)

## License

MIT © 2026 OpsVault contributors
