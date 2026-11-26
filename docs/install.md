# 在线安装与入口锁定

## 首启

服务启动时若尚无管理员且不存在 `data/install.lock`：

1. 控制台打印安装地址与一次性 **Setup Token**；
2. 访问 `/setup`，输入 Token；
3. 依次完成：
   - **环境检查**（Node ≥ 22、data 目录可写、端口、时区）
   - **数据库配置**：SQLite（默认 `data/opsvault.db`）或 PostgreSQL（主机/端口/库名/用户/密码，支持连接测试）
   - **管理员账号**（邮箱 + ≥8 位密码，可后续在设置中启用 TOTP）
   - **完成**：写入 `data/install.lock` 与 `data/runtime-config.json`（记录所选数据库），删除 Setup Token

## 入口锁定（安全关键）

- 安装完成后：
  - `GET /setup` 与全部 `/api/v1/setup/*`（除 `status`）由服务端强制返回 **404**（不是隐藏 UI）。
  - `data/install.lock` 存在且数据库至少有一个管理员。
- 记得把安装期间的控制台输出视为敏感信息（包含一次性 Token）。

## 非交互安装（Docker/CI）

设置以下环境变量后首次启动即自动创建管理员并锁定安装：

```bash
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=至少8位强密码
# 可选
INSTALL_LOCK=true
```

## 重装

Web 端永不提供重置。只能在服务器上执行：

```bash
pnpm cli reset-install   # 仅移除安装锁；若仍有用户会拒绝
pnpm cli reset-install --yes
# 前提：先备份并清空用户数据（否则脚本会拒绝）
```

重启后 `/setup` 重新开放，并打印新的 Setup Token；操作写入审计。

## 切换数据库

- 安装向导中选择 PostgreSQL 并完成即生效（写入 runtime-config 并切换连接）。
- 已有部署迁移数据库请参考 [deployment.md](deployment.md)：备份 → 新建目标库 → 初始化 → 修改 `runtime-config.json` 或环境变量 → 重启。迁移工具不在 v0.1 范围内，需手动导入。

## 故障排查

| 现象 | 处理 |
|---|---|
| 访问 `/setup` 404 | 已安装并锁定；去 `/login`；确需重装见上 |
| 忘记 Setup Token | 未安装时重启服务会重新打印；或 `pnpm cli setup-token` 查看（仅未安装时） |
| 数据库连接失败 | 检查 `DATABASE_URL`、网络、凭据；向导支持连接测试 |
| 登录后写操作 403 CSRF_FAILED | 刷新页面或重新登录以更新 csrf cookie |
