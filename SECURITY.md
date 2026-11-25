# 安全策略

## 支持的版本

| 版本 | 安全更新 |
|---|---|
| 0.1.x | ✅ |

## 私密披露

请通过 GitHub 仓库的 **Security Advisories**（`Security → Advisories → Report a vulnerability`）私密报告安全问题，不要在公开 Issue 中粘贴可利用细节、真实凭据或服务器信息。

请尽量提供：
- 影响版本与部署形态（Docker/裸机、SQLite/PostgreSQL）
- 复现步骤与最小 PoC
- 影响面（未授权读取、越权、拒绝服务等）

我们会在确认后尽快修复并发布安全版本；修复版本发布后会在 Release Notes 中致谢（除非你要求匿名）。

## 设计中的安全边界

- 凭据/私钥 AES-256-GCM 信封加密；MASTER_KEY 与数据库分离存放。
- reveal / 私钥导出要求登录会话 + 5 分钟内二次验证，始终写审计。
- Agent 令牌默认只读；reveal、私钥导出与 Web 终端对 Agent 一律 403。
- SSH 主机密钥 TOFU；指纹变化拒绝连接并审计。
- 安装入口由一次性 Setup Token 保护，安装完成后服务端强制 404；重装仅限 CLI。
- 升级包必须校验 SHA256；升级/回滚写审计。
