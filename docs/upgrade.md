# 版本与在线升级

## 版本信息

- `GET /api/v1/system/version`：版本、commit、构建时间、数据库引擎、安装状态。
- `GET /api/v1/system/updates`（管理员）：查询 GitHub Releases 最新版本，返回是否可升级、发布说明、下载地址与校验和下载地址。
- `GET /api/v1/system/update-history`（管理员）：版本历史（安装与升级事件）。
- `POST /api/v1/system/check-updates`（管理员）：强制刷新检查。

更新检查由 `GITHUB_REPO` 与 `UPDATE_CHECK=true` 启用；可关闭或指向兼容镜像（实现中通过标准 GitHub API）。

## 发布流程（GitHub）

打 tag（如 `v0.2.0`）触发 `.github/workflows/release.yml`：

1. 构建并测试；
2. 打包 `boerfen-assets-<version>.tar.gz` 与 `SHA256SUMS`；
3. 构建并推送 GHCR 镜像（`ghcr.io/<owner>/<repo>`）；
4. 创建 GitHub Release（自动生成 notes 并附带包与校验和）。

## 升级方式

### Docker

使用发布镜像（推荐）：

```bash
export BOERFEN_IMAGE=ghcr.io/<owner>/<repo>:latest
docker compose pull app
docker compose up -d app
```

从源码/归档升级：

```bash
docker compose build app
docker compose up -d app
```

升级前建议备份数据卷/数据库与 `master.key`。镜像内含迁移逻辑，启动时自动迁移。

### 裸机

```bash
./scripts/upgrade.sh --version v0.2.0 --dry-run   # 下载 + SHA256 校验，不做变更
./scripts/upgrade.sh --version v0.2.0             # 迁移 + symlink 切换 + 重启
```

脚本行为：

- 从 GitHub Release 下载归档与 `SHA256SUMS`（或使用 `--artifact` + `--checksum` 本地文件）；
- 校验失败立即退出；
- 解压到 `$BOERFEN_BASE_DIR/releases/<version>`；归档含构建产物时仅安装生产依赖，否则自动安装并构建；
- 以 `$BASE_DIR/.env` 与 `DATA_DIR` 执行数据库迁移；
- 原子切换 `current` symlink；执行 `BOERFEN_RESTART_CMD`（如 `systemctl restart boerfen`）；
- 成功或失败均写入 `version_history` 与审计（`record-upgrade` CLI）；
- 失败自动回滚到上一个版本链接。

常用参数：

| 参数 | 说明 |
|---|---|
| `--version` | 目标版本（v 前缀可省略） |
| `--dry-run` | 只下载与校验，不切换 |
| `--artifact` | 本地归档路径（离线/演练） |
| `--checksum` | 直接提供目标归档 SHA256 |
| `--repo` | GitHub `owner/name`（默认读 `GITHUB_REPO`） |
| `--dir` | 部署根目录（默认 `/opt/boerfen`，可由 `BOERFEN_BASE_DIR` 指定） |
| `--restart-cmd` | 升级后重启命令（也可用 `BOERFEN_RESTART_CMD`） |

## 数据库迁移

- 迁移随服务启动自动执行（SQLite 与 PostgreSQL 双方言）。
- 升级前自动备份建议：
  - SQLite：复制 `data/` 全目录；
  - PostgreSQL：`pg_dump`。
- 回滚代码不会回滚数据库 schema；回滚版本包含旧代码时若迁移不兼容需从备份恢复。

## Agent 视角

- 版本与更新检查通过只读 API 与 MCP 工具（`system_version`）暴露，便于 Agent 巡检与升级建议；
- 升级执行不开放给 Agent/MCP，必须由人类在服务器或管理界面操作。
