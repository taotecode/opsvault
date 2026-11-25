## 变更说明

<!-- 动机、影响面、关联 Issue -->

## 类型

- [ ] feat
- [ ] fix
- [ ] docs
- [ ] refactor
- [ ] test
- [ ] chore

## 验证

- [ ] `pnpm -r typecheck`
- [ ] `pnpm -r lint`
- [ ] `pnpm -r test`（含 SQLite；如涉及数据库请补充 PostgreSQL）
- [ ] `pnpm -r build`
- [ ] UI 变更附浅色/深色截图

## 安全自查

- [ ] 未提交 `.env` / `data/` / 真实凭据或私钥
- [ ] 涉及敏感操作时保留二次验证与审计
- [ ] Agent 令牌边界（reveal / 私钥 / 终端 403）未被削弱
