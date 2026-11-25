# Agent 接入

铂尔分把「人用的功能」同时做成「Agent 能读、能调、管得住」的接口。四种方式：

## 1. 机器可读文档

- OpenAPI 3.1：`GET /api/v1/openapi.json`（稳定 operationId、`x-safety` 标注、错误示例）
- 人类文档：`/api/docs`（Scalar UI）
- LLM 指南：`/llms.txt`（认证、端点、规则与禁忌）
- 能力发现：`GET /api/v1/meta`

## 2. Agent 令牌

管理员 → API 与 Agent → 新建令牌：

- `kind=agent`：默认只读；写 scope 需显式勾选（hosts:write）。
- 允许的 Agent scope：hosts:read/write、credentials:read、keypairs:read、audit:read、system:read；Agent 不支持 keypairs:write / credentials:write。
- Agent 的所有调用（含读取）写入审计；密钥生成/部署、凭据 reveal、私钥导出、终端一律 403。
- 拒绝清单（永远 403，即使有 scope）：凭据 reveal、私钥导出、Web 终端。
- 令牌明文仅显示一次；库存哈希；可吊销、可设过期；审计标注 `(Agent)`。

## 3. MCP Server（Streamable HTTP）

- 端点：`POST /mcp`；认证：Bearer Agent 令牌。
- 工具（11 个）：`hosts_list` `host_get` `hosts_search` `hosts_create` `hosts_update` `host_probe`
  `credentials_list_meta` `keypairs_list` `keypairs_connect_command` `audit_list` `system_version`。
- 工具描述包含参数说明与示例，直接可被 Claude Desktop / Claude Code 等客户端挂载。

Claude Code 的 `.mcp.json` 示例：

```json
{
  "mcpServers": {
    "boerfen-assets": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer wfv_xxx" }
    }
  }
}
```

> 不同 MCP 客户端字段略有差异；核心是 URL + Bearer 头。

## 4. 官方 Skill

```bash
cp -r skills/boerfen-assets ~/.claude/skills/
export BOERFEN_BASE_URL=http://localhost:8080
export BOERFEN_API_TOKEN=wfv_xxx
skills/boerfen-assets/scripts/api.sh hosts list --env prod
```

`SKILL.md` 指导模型何时使用、如何调用、如何安全操作；`api.sh` 封装常用命令：

```
hosts list [--env …] [--status …] | hosts get <id> | hosts probe <id>
keys list | keys connect <id> [hostId]
creds list
audit list [--category …]
version
```

## 5. Agent 友好的响应

- 错误带 `code` / `hint` / `docsUrl`，模型可据此修正参数或提示用户；
- 支持 `?fields=` 稀疏字段与 cursor 分页，降低 token 消耗；
- 写操作返回变更后的资源与审计记录；
- 安装/升级状态可读（`/setup/status`、`/system/updates`），但执行权限保留给人类。

## 安全规则（务必遵守）

1. 不请求、不打印凭据明文或私钥；不要尝试绕过 403。
2. 写操作前向用户确认目标主机与预期影响。
3. 不在输出中打印完整令牌；引用服务器使用 `id + name`。
4. `/setup` 404 表示平台已安装，不要尝试重装。
5. 终端与私钥操作必须回到人类界面完成。
