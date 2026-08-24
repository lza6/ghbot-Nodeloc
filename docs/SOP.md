# ghbot 标准操作流程（SOP）

## 目标

确保 ghbot 的部署、维护、排障和交接有统一标准，新成员可独立操作。

## 1. 开发环境搭建

### 1.1 前置条件

- Node.js >=22 <26
- npm >=10
- Git
- 推荐：VS Code + ESLint + Prettier 插件

### 1.2 首次安装

```bash
git clone <repo-url>
cd ghbot
npm install
npm run typecheck    # 确认类型检查通过
npm test             # 确认 329 测试全绿
npm run build        # 确认编译成功
```

### 1.3 环境变量

复制 `.env.example` 到 `.env`，按需填写：

```bash
cp .env.example .env
# 编辑 .env 填入必要配置
```

## 2. 开发循环

### 2.1 标准流程

```bash
# 1. TypeScript 类型检查
npm run typecheck

# 2. ESLint 检查
npm run lint

# 3. 格式化检查
npm run format:check

# 4. 运行测试
npm test

# 5. 构建
npm run build
```

### 2.2 提交前检查清单

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 0 error
- [ ] `npm run format:check` 通过
- [ ] `npm test` 全部通过
- [ ] 新功能有对应测试
- [ ] README 已同步更新

## 3. 新增功能流程

### 3.1 新增 API 端点

1. 在 `src/` 下新建模块文件
2. 在 `src/actions/router.ts` 注册新 EventHandler
3. 在 `test/` 下新建测试文件
4. 运行 `npm test` 确认全绿

### 3.2 新增审查检查

1. 修改 `src/review/gooseReviewer.ts` 的 `buildPrompt` 内容
2. 更新 `src/review/normalize.ts` 的校验规则（如需）
3. 更新测试文件

### 3.3 新增配置项

1. 在 `src/config.ts` 的 `configSchema` 中添加新字段
2. 在 `.env.example` 中添加示例
3. 在 README 中文档化

## 4. 发布流程

### 4.1 版本号规则

- 大版本：`v1.0.0` → `v2.0.0`（破坏性变更）
- 小版本：`v1.2.0` → `v1.3.0`（新功能）
- 补丁：`v1.2.0` → `v1.2.1`（bug 修复）

### 4.2 发布命令

```bash
# 1. 确认所有门禁通过
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build

# 2. 提交
git add -A
git commit -m "feat: description"

# 3. 打标签
git tag -a v2.0.0 -m "v2.0.0 — description"

# 4. 推送
git push origin main
git push origin v2.0.0
```

## 5. 排障指南

### 5.1 测试失败

```bash
# 单独运行失败的测试文件
node --import tsx --test test/<file>.test.ts

# 查看详细错误
node --import tsx --test test/<file>.test.ts 2>&1 | grep -A 20 "fail"
```

### 5.2 类型错误

```bash
npm run typecheck 2>&1 | grep "error TS"
```

### 5.3 Webhook 启动失败

```bash
# 确认环境变量完整
WEBHOOK_ENABLED=true
WEBHOOK_SECRET=<secret>

# 检查端口占用
netstat -ano | findstr :3000
```

## 6. 关键文件索引

| 文件                          | 用途                    |
| ----------------------------- | ----------------------- |
| `src/config.ts`               | 所有环境变量 zod schema |
| `src/actions/router.ts`       | 事件路由注册            |
| `src/review/processor.ts`     | 审查编排核心            |
| `src/review/gooseReviewer.ts` | 审查 prompt + schema    |
| `src/review/policy.ts`        | 审查策略逻辑            |
| `src/ai/gooseCli.ts`          | goose CLI 封装          |
| `src/webhook/server.ts`       | webhook HTTP 服务       |
| `src/logger.ts`               | pino 日志配置           |
| `src/retry.ts`                | 指数退避重试            |
| `src/github/errors.ts`        | 共享错误工具            |
| `src/metrics/collector.ts`    | 指标收集器              |
| `src/ai/failureMessages.ts`   | 失败分类告警            |
| `src/review/merge-guard.ts`   | 合并防重入              |
| `src/review/staleness.ts`     | 陈旧检测                |
| `src/webhook/queueStore.ts`   | 队列持久化              |
| `docs/optimization-record.md` | 优化验证记录            |
