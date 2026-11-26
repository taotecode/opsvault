# 架构与实现决策记录

记录关键取舍，便于后续维护与开源评审。

## D1 数据库：Kysely + 双方言，而不是 Drizzle/Prisma

- 需求：SQLite 零依赖起步 + PostgreSQL 生产可选。
- Kysely 单 schema/类型接口可同时服务两种方言；迁移使用统一的 `text/integer + ISO 时间`，在两种数据库上均可执行。
- Prisma 体积与代码生成较重；Drizzle 的双方言 schema 需要维护两套定义。
- 代价：放弃部分 ORM 便利性；通过 service 层集中查询逻辑缓解。

## D2 密钥生成使用系统 ssh-keygen

- ssh2 不能解析 Node 生成的 PKCS#8（尤其 Ed25519），也无法导出 OpenSSH 私钥。
- `ssh-keygen` 是 OpenSSH 官方工具，生成格式与 ssh2 完全兼容；服务器/Docker 均安装 openssh-client。
- 导入支持 OpenSSH 私钥与 RSA PKCS#1；Ed25519 PKCS#8 给出明确错误提示。
- 带口令导入时用 `ssh-keygen -p -P … -N ''` 去口令后由平台重新加密存储。

## D3 认证：自实现会话+CSRF，未引入额外会话框架

- Cookie `ov_session`（HttpOnly）与 `ov_csrf` 双提交；会话令牌仅存哈希。
- API 令牌独立 scope 模型；Agent 敏感操作专用拒绝清单。
- 简单、可审计、无额外依赖；所有写路由统一在认证钩子里校验 CSRF。

## D4 安装向导与锁定

- 一次性 Setup Token 打印到控制台（避免安装入口被抢注）。
- 安装完成写 `data/install.lock` 与 `runtime-config.json`（记录数据库选择），并切换运行中的连接。
- `/setup` 页面与安装 API 服务端 404；重装仅 CLI。
- 支持 `ADMIN_EMAIL/ADMIN_PASSWORD` 非交互安装，便于 Docker/CI。

## D5 在线升级：引导式 + 脚本，而非进程内自替换

- 版本检查通过 GitHub Releases；Docker 形态给出/触发 compose 命令；裸机通过 `upgrade.sh`（SHA256、迁移、symlink 切换、回滚）。
- 升级执行对 Agent/MCP 关闭，避免被远程利用。
- 发布工作流产出归档、SHA256SUMS 与 GHCR 镜像。

## D6 MCP：Streamable HTTP + 每请求无状态 Server

- 使用官方 SDK，`sessionIdGenerator: undefined` + `enableJsonResponse: true`，每个请求创建独立 server/transport，简化水平扩展与无会话管理。
- 工具面只保留资产域与元数据；写工具需 scope；敏感操作不暴露。

## D7 UI：公开组件 + 液态玻璃

- shadcn/ui（Radix）+ TanStack + cmdk + Sonner + next-themes + lucide + zxcvbn-ts；不自造基础组件。
- 玻璃视觉以 CSS 玻璃层为主（登录/安装页使用 `liquid-glass-react`），确保在大量面板下性能可控，并可在库不可用时回退纯 CSS。

## D8 探测：固定脚本 + 分段解析

- 单次 SSH 会话执行只读白名单脚本，`@@KEY@@` 分段；每段独立容错，partial 表示缺失字段。
- 避免逐条命令往返带来的时序与超时问题；解析器有单元测试覆盖。

## D9 一主机多凭据：连接时择优回退，状态落库

- 一台主机可关联多条凭据，`host_credentials` 增加 `role`（primary/linked）与检测状态三列；旧的 `hosts.credential_id` 保留为兼容字段，迁移时回填关联表。
- 候选顺序：主机密钥对 → 手动指定 → 主凭据 → 其余关联（按关联创建时间）。顺序在服务端统一实现（`lib/authCandidates.ts`），探测、终端、密钥部署共用。
- 手动指定只尝试该凭据、不回退，便于确认某条密码是否真的失效；自动模式下每次尝试的结果写回 `last_check_ok / last_check_error / last_checked_at`，列表与主机详情直接展示。
- 凭据页另有「检测」按钮，逐主机验证并写审计；改名/改关联不会重置主凭据角色，轮换内容后状态回退为未检测。
