# 安全模型

## 威胁与对策

| 威胁 | 对策 |
|---|---|
| 数据库泄露 | 凭据/私钥信封加密（随机 DEK + KEK）；MASTER_KEY 不入库，可存环境变量或 0600 文件 |
| 凭据明文外泄 | 列表只返回元数据；reveal 需登录会话 + 5 分钟内密码二次验证 + 审计；前端 10 秒自动隐藏 |
| 私钥外泄 | 仅在生成时返回一次；后续导出需二次验证；Agent/API 令牌永远 403 |
| Agent 越权 | 令牌 scope 白名单；Agent 默认只读；reveal / 私钥 / 终端专用拒绝清单；审计标注 (Agent) |
| 会话劫持 | HttpOnly Cookie、SameSite=Lax、令牌哈希存储、可吊销、滑动过期、写请求 CSRF 双提交 |
| 登录爆破 | Argon2id + 登录限流（8/分钟/IP 级别）+ 失败审计 |
| 安装入口被抢注 | 首启一次性 Setup Token（打印到控制台）；安装后 `/setup` 与安装 API 服务端 404；重装仅 CLI |
| SSH MITM | 主机密钥 TOFU；指纹变化拒绝连接并审计 |
| 命令注入 | 探测命令固定白名单；公钥写入前格式校验且单引号转义；不拼接用户输入到 shell 之外 |
| 升级包被篡改 | 发布 SHA256SUMS；`upgrade.sh` 校验后才迁移/切换；升级与回滚写审计 |
| 令牌滥用 | 令牌仅显示一次、仅存哈希、可吊销、可设过期、记录 last_used |

## 加密细节

- 密码哈希：Argon2id（memory 19MiB, time 2, parallelism 1）。
- 凭据：AES-256-GCM；每条随机 32B DEK；DEK 与值分别加密；IV 12B 随机，GCM tag 校验。
- API 令牌：`ovt_` + 32B 随机十六进制；库存 SHA-256。
- Setup Token：随机 4+4 hex，写入 `data/setup.token`（0600），安装完成删除。
- MASTER_KEY：base64 32B；优先环境变量，否则首启生成 `data/master.key`（0600）。

## 角色与权限矩阵

| 能力 | admin | operator | viewer | agent（默认） |
|---|---|---|---|---|
| 资产读/写/探测 | ✓ | ✓ | 读 | 读；写需 scope |
| 凭据读元数据/写 | ✓ | ✓ | 读元数据 | 读元数据；写不开放 |
| 凭据 reveal | ✓ | ✓ | ✗ | **403** |
| 密钥读/写/部署/验证 | ✓ | ✓ | 读 | 读；写不开放 |
| 私钥导出 | ✓ | ✓ | ✗ | **403** |
| Web 终端 | ✓ | ✓ | ✗ | **403** |
| 用户/令牌/设置写 | ✓ | ✗ | ✗ | ✗ |
| 审计读 | ✓ | ✓ | ✓ | 需 audit:read |

## 审计

所有登录、写操作、reveal、终端开启/关闭、密钥部署/验证/导出、Agent 调用均写 `audit_logs`，含 actor、kind、IP、UA、成功与否与 JSON 详情。日志字段经过脱敏（不记录密文/明文凭据）。

## 运维建议

- 始终通过 HTTPS 反代（Caddy/Nginx）暴露；`BASE_URL` 设为 https 地址以启用 Secure Cookie。
- 定期备份数据库与 `data/master.key`；两者缺一不可。
- 生产使用 PostgreSQL 并开启外部备份；SQLite 部署需备份 `data/` 全目录。
- 遵循最小权限：日常运维使用 operator，管理员仅用于用户/令牌/设置管理。
- 定期轮换 MASTER_KEY 与 API 令牌。文件模式可停止服务后执行 `pnpm cli rotate-master-key --yes`（自动备份 SQLite 并重加密凭据、私钥与 TOTP 密钥）；环境变量模式需自行更新 `MASTER_KEY` 并重启。
- 运维建议：升级前先备份数据库与 `master.key`；升级脚本校验 SHA256 并写入版本历史/审计。
