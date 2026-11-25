# Roadmap

> 规划中的能力，非承诺排期；欢迎在 Discussions 中讨论优先级。

## 近期

- 云厂商资产同步（阿里云 / 腾讯云 / AWS 导入与到期同步）
- SFTP 文件管理（基于同一 SSH 连接与审计链路）
- 批量命令执行（带审批与命令白名单）
- 通知渠道：邮件、企业微信/飞书/钉钉 Webhook 模板
- 审计导出（CSV / JSONL）与保留策略
- 密钥轮换向导（生成→部署→验证→下线）

## 中期

- OIDC / LDAP / SSO 与企业目录同步
- 会话录像与回放（终端）
- MCP 写工具扩展（主机资产域之外仍需人类确认）
- PostgreSQL 高可用与读写分离优化
- 多租户与项目隔离
- 插件系统（探测采集器、告警通道）

## 长期

- Windows 主机探测（WinRM / OpenSSH for Windows）
- 与 IaC（Terraform provider / Ansible inventory）双向集成
- 资产关系图谱与影响面分析
- 审计区块链式不可篡改存储（可选）
