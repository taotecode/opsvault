# 部署

## 环境变量

参考根目录 `.env.example`。关键项：

| 变量 | 说明 |
|---|---|
| `PORT` / `BASE_URL` | 监听端口与对外地址（影响快速连接与安装提示） |
| `DATA_DIR` | 数据目录（SQLite 文件、master key、安装锁），默认 `./data` |
| `DB_DRIVER` | `sqlite`（默认）或 `postgres` |
| `DATABASE_URL` | PostgreSQL 连接串（`DB_DRIVER=postgres` 时必填） |
| `MASTER_KEY` | base64 32B；留空则首启生成 `data/master.key`（0600） |
| `GITHUB_REPO` / `UPDATE_CHECK` | 在线更新检查（例如 `owner/opsvault`；默认关闭） |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 非交互安装（首次启动自动创建管理员并锁定安装入口） |
| `INSTALL_LOCK` | 强制锁定安装入口 |

## Docker（推荐）

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs app | head -20   # Setup Token
```

- 数据默认持久化在命名卷 `opsvault-data`（映射 `/app/data`）。
- 使用 PostgreSQL：

```bash
export POSTGRES_PASSWORD="$(openssl rand -base64 24)"
docker compose --profile pg up -d pg
# PostgreSQL 仅绑定 127.0.0.1；密码必须与 POSTGRES_PASSWORD 一致
DB_DRIVER=postgres \
DATABASE_URL="postgres://opsvault:${POSTGRES_PASSWORD}@pg:5432/opsvault" \
docker compose up -d app
```

- 安装向导写入的 `data/runtime-config.json` 优先于环境变量；安装完成后切换数据库请在向导中操作或编辑该文件（已装环境需重启）。
- 镜像包含 `openssh-client`（密钥生成/导入规范化需要 `ssh-keygen`）。

### 反向代理示例（Caddy）

```caddyfile
assets.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

将 `BASE_URL` 设置为 `https://assets.example.com`，以获得 Secure Cookie 与正确命令提示。WebSocket（终端）由反向代理透传即可。

## 裸机（Node.js 22）

```bash
git clone <repo>
cd opsvault
cp .env.example .env
pnpm install --frozen-lockfile
pnpm -r build
node apps/server/dist/main.js
# 生产建议 systemd（current 为 upgrade.sh 维护的符号链接）：
# ExecStart=/usr/bin/node /opt/opsvault/current/apps/server/dist/main.js
# WorkingDirectory=/opt/opsvault/current
# EnvironmentFile=/opt/opsvault/.env
# Environment=DATA_DIR=/opt/opsvault/data
```

裸机需要系统安装 `ssh-keygen`（`openssh-client`）。

## 备份与恢复

- 总是同时备份数据库与主密钥：
  - SQLite：`data/opsvault.db*` 与 `data/master.key`
  - PostgreSQL：`pg_dump` + `data/master.key`
- 恢复：停止服务 → 还原数据库与 `master.key` → 启动。
- 丢失 `master.key` 将无法解密已有凭据/私钥，请与数据库分开安全保存。

## 健康检查

- `GET /api/v1/health`：进程与数据库连通性。
- `GET /api/v1/setup/status`：安装状态（未安装时可公开访问，仅返回最小信息）。
- 日志为 pino JSON；`LOG_LEVEL` 可调。

## 升级

参见 [upgrade.md](upgrade.md)。
