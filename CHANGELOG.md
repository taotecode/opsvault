# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-26

### 新增

- 服务器资产台账：分组、环境、标签、到期提醒、手动字段；SSH 自动探测（系统/硬件/网络/负载/虚拟化/Docker）与快照。
- 凭据保险库：AES-256-GCM 信封加密、二次验证查看（10 秒自动隐藏）、密码生成器、强度评估。
- 密钥全链路：Ed25519/RSA-4096 生成、导入（OpenSSH/PKCS#1）、下载（私钥需二次验证）、快速连接命令、可用性检测、公钥部署、删除。
- Web 终端（xterm.js + WebSocket + ssh2）与会话审计。
- 用户与权限：邀请制、admin/operator/viewer、TOTP 2FA、会话与令牌安全、全量审计。
- 设置与运维：探测计划（每小时/每日）、并发/超时/快照保留、登录失败锁定、二次验证有效期、Webhook 测试发送、数据导出、审计清理、MASTER_KEY 状态与轮换 CLI。
- API：OpenAPI 3.1（稳定 operationId、x-safety）、llms.txt、MCP（Streamable HTTP，10+ 工具）、官方 Claude Skill。
- 在线安装向导（一次性 Setup Token、安装锁、安装后 404）、非交互安装、CLI 重置。
- 在线升级支持：版本/更新检查、版本历史、`scripts/upgrade.sh`（SHA256、迁移、回滚）、GitHub Release + GHCR 工作流。
- 双数据库：SQLite 与 PostgreSQL（Kysely，双方言迁移与测试）。
- 前端：React 19 + Tailwind 4 + shadcn/ui/Radix 组件体系，iOS 液态玻璃设计，明暗主题、响应式、⌘K 命令面板。
- Docker 多阶段构建、docker-compose（含 PostgreSQL profile）、CI 与社区文件齐全。
