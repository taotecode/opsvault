---
name: opsvault
description: 查询与管理 OpsVault 服务器资产平台：列出/搜索服务器、触发 SSH 探测、创建或更新服务器资产、查看凭据元数据、密钥部署与验证状态、生成快速连接命令、读取审计与版本信息。适用于用户问服务器清单、到期提醒、资产盘点、探测配置、密钥能否使用等场景。
---

# OpsVault 服务器资产管理 · Agent Skill

通过平台 REST API 读取资产与执行受控写操作。API 详情见 `${OPSVAULT_BASE_URL}/llms.txt` 与 `/api/v1/openapi.json`。

## 配置

```bash
export OPSVAULT_BASE_URL=http://localhost:8080
export OPSVAULT_API_TOKEN=ovt_...   # Agent 令牌（默认只读；写操作需对应 scope）
# version 需要 system:read；Agent 令牌不能生成/部署密钥、不能 reveal 凭据、不能开终端。
```

需要 `scripts/api.sh` 可执行权限：`chmod +x scripts/api.sh`。

## 何时使用

- “帮我盘点服务器 / 哪些机器快到期 / 某台机器什么配置”
- “触发一次探测 / 批量检查在线状态”
- “新增一台服务器资产 / 更新带宽与到期日”
- “看下凭据元数据（不读明文）/ 密钥部署在哪些机器 / 生成 ssh 命令”
- “最近做了什么操作 / 当前平台版本”

## 何时不要使用

- 请求凭据明文、私钥内容或进入服务器终端 —— 平台对 Agent 一律 403，必须引导用户在 Web 界面完成（reveal 需二次验证）。
- 安装或升级平台 —— 属于人类操作；可读取 `/api/v1/setup/status`、`/api/v1/system/version` 辅助排障。

## 标准流程

1. 先 `api.sh hosts list --env prod` 或 `api.sh hosts search <关键字>` 拿到 `id/name/status/expiresAt`。
2. 需要详情：`api.sh hosts get <id>`。
3. 需要最新硬件：`api.sh hosts probe <id>`（需 hosts:write；先向用户确认目标）。
4. 写操作（创建/更新）先向用户确认字段与影响范围，再调用。
5. 输出时引用 `name + id`，不要打印完整令牌；不要打印任何 secret。

## 命令速查

```bash
api.sh hosts list [--env prod|staging|dev] [--status online|warning|offline|pending]
api.sh hosts search <q>
api.sh hosts get <id>
api.sh hosts create <json>
api.sh hosts update <id> <json>
api.sh hosts probe <id>
api.sh hosts batch-probe <id> [id...]
api.sh keys list
api.sh keys connect <keypairId> [hostId]
api.sh creds list
api.sh audit list [--category auth|asset|cred|key|api|user] [--limit 20]
api.sh version
```

## 安全规则（硬性）

1. 永不调用 `credentials/{id}/reveal` 或 `keypairs/{id}/private-key`；收到 403 即停止并告知用户去 Web 界面。
2. 所有写操作前先确认目标与预期影响。
3. 不缓存、不打印明文凭据或私钥；不输出完整令牌。
4. 遇到 `/setup` 404 表示平台已安装，不要尝试重装。
