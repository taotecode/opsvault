# API 文档

- Base URL：`/api/v1`；OpenAPI 3.1：`/api/v1/openapi.json`（Scalar UI：`/api/docs`）；LLM 指南：`/llms.txt`。
- 认证：
  - 浏览器会话：登录后 Cookie `ov_session`；写请求需 `x-csrf-token`（值同 `ov_csrf` Cookie）。
  - API/Agent：`Authorization: Bearer ovt_…`。
- 响应：`{ "data": … }` 或 `{ "data": […], "page": { "cursor": null, "hasMore": false } }`。
- 错误：`{ "error": { "code", "message", "hint?", "docsUrl?" } }`。
- 分页：`?limit=&cursor=`；稀疏字段：`?fields=id,name,status`。
- `x-safety`：read / write / sensitive；sensitive 端点对 Agent 令牌一律 403。

## 端点

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/health` | 公开 | 健康检查 |
| GET | `/meta` | 公开 | 能力发现（auth、scope、限速） |
| POST | `/auth/login` | 公开 | 登录（限流 8/min） |
| POST | `/auth/logout` | 会话 | 退出并吊销会话 |
| GET | `/auth/me` | 认证 | 当前用户与 reveal 状态 |
| POST | `/auth/reveal` | 会话 | 敏感操作二次验证（5 分钟窗口） |
| POST | `/auth/password` | 会话 | 修改密码 |
| POST | `/auth/totp/setup` / `enable` / `disable` | 会话 | TOTP 绑定与开关（重新绑定/停用需 reveal） |
| GET | `/setup/status` | 公开 | installed/locked/version |
| GET | `/bootstrap/status` | 公开（未安装时） | 安装状态别名；安装后 404 |
| GET | `/setup/env-check` | 公开（未安装时） | Node/OpenSSH/data 目录自检 |
| GET | `/hosts` | hosts:read | 列表（q/env/status/limit/cursor） |
| GET | `/hosts/{id}` | hosts:read | 详情 |
| POST | `/hosts` | hosts:write | 创建 |
| PATCH | `/hosts/{id}` | hosts:write | 更新（手动字段） |
| DELETE | `/hosts/{id}` | hosts:write | 删除 |
| POST | `/hosts/{id}/probe` | hosts:write | SSH 探测 |
| POST | `/hosts/batch-probe` | hosts:write | 批量探测（并发按设置，默认 4） |
| GET | `/hosts/{id}/snapshots` | hosts:read | 快照列表 |
| WS | `/hosts/{id}/terminal` | 会话 admin/operator | Web 终端 |
| GET | `/credentials` | credentials:read | 凭据元数据（无明文） |
| POST | `/credentials` | credentials:write | 创建（会话） |
| PATCH/DELETE | `/credentials/{id}` | credentials:write | 更新/删除 |
| POST | `/credentials/{id}/reveal` | 会话 + reveal 窗口 | 查看明文（Agent 403） |
| POST | `/credentials/generate-password` | credentials:write | 生成强密码 |
| GET | `/keypairs` | keypairs:read | 密钥列表 |
| POST | `/keypairs/generate` | keypairs:write | 生成（返回私钥仅一次） |
| POST | `/keypairs/import` | keypairs:write | 导入私钥/公钥 |
| DELETE | `/keypairs/{id}` | keypairs:write | 删除 |
| POST | `/keypairs/{id}/deploy` | keypairs:write | 部署公钥 |
| POST | `/keypairs/{id}/verify` | keypairs:write | 可用性检测 |
| GET | `/keypairs/{id}/connect-command` | keypairs:read | ssh/scp 命令 |
| GET | `/keypairs/{id}/public-key` | keypairs:read | 下载公钥 |
| POST | `/keypairs/{id}/private-key` | 会话 + reveal 窗口 | 导出私钥（Agent 403） |
| GET/POST | `/tokens` | 管理员 | 令牌列表/创建（明文仅一次） |
| DELETE | `/tokens/{id}` | 管理员 | 吊销 |
| GET | `/users` | 管理员 | 用户列表 |
| POST | `/users/invite` | 管理员 | 邀请（返回临时密码一次） |
| PATCH | `/users/{id}` | 管理员 | 角色/状态 |
| GET | `/audit` | audit:read | 审计（category/q/success/from/to） |
| DELETE | `/audit` | 会话管理员 + reveal | 清空审计（操作本身重新入库） |
| GET/PATCH | `/settings` | 读: settings:read；写: 会话管理员 | 平台设置 |
| POST | `/settings/webhook-test` | 会话管理员 | 发送 Webhook 测试消息 |
| GET | `/system/version` | system:read | 版本、数据库、MASTER_KEY 来源 |
| GET | `/system/updates` | 会话管理员 | 更新检查 |
| GET | `/system/update-history` | 会话管理员 | 版本历史 |
| POST | `/system/export` | 会话管理员 + reveal | 导出全部数据 JSON（Agent 403） |
| POST | `/mcp` | Bearer Agent | MCP Streamable HTTP |

## 示例

```bash
# 登录（保存 Cookie）
curl -i -c jar.txt -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"…"}' \
  http://localhost:8080/api/v1/auth/login

# Agent 令牌读取资产
curl -H "Authorization: Bearer ovt_xxx" \
  'http://localhost:8080/api/v1/hosts?env=prod&fields=id,name,status,expiresAt'

# 触发探测（需要 hosts:write 的令牌或会话 + CSRF）
curl -X POST -H "Authorization: Bearer ovt_xxx" \
  http://localhost:8080/api/v1/hosts/<id>/probe
```

## 错误码

`UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED` `CONFLICT` `RATE_LIMITED`
`SETUP_REQUIRED` `SETUP_LOCKED` `CSRF_FAILED` `SSH_CONNECT_FAILED` `SSH_AUTH_FAILED`
`KEY_PARSE_FAILED` `UPGRADE_UNAVAILABLE` `INTERNAL`

错误响应带 `hint` 与 `docsUrl`，便于模型理解与自修复。
