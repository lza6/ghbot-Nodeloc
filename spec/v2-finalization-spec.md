# Spec: ghbot v2 终局闭环 — 剩余未落地项全量补齐

## Objective

补齐 critical-review-v2.md 与 audit-v2-final.md 审计发现的所有 P1 项，使 v2.0 成为可真实上生产、可闭环、可一次调用跑通的版本。

## 现状（审计证据）

已落地：321 tests 绿、M0/M1/M2 核心模块定义完成。
未闭环（P1 证据）：

1. failureMessages.ts 定义完成但未接入 goose 调用错误路径
2. processor.ts 与 conflictResolver.ts 超 800 行（1736/1250），维护困难
3. waitForMergeable 无总超时——极端网络下可无限挂起
4. 无陈旧检测——审查期间 head 变化整轮浪费
5. webhook 队列无持久化——进程重启丢任务
6. config.ts 无 AI_PROVIDER 抽象——换 provider 需大改

## Commands

```
Build:  npm run build
Test:   npm test
Lint:   npm run lint
Type:   npm run typecheck
Format: npm run format:check
Coverage: npm run ci:test
```

## Project Structure

- src/ 源码；test/ 测试；docs/ 报告；.claude/skills/ 技能
- 新增文件按审计建议命名

## Code Style

- 严格 TS 严格模式；不可变风格；pino 日志；zod 校验；文件 <400 行

## Testing Strategy

- node:test + tsx；每个新函数必有测试；覆盖率 function ≥85%

## Boundaries

- Always: 提交前 typecheck+test 全绿
- Ask first: 拆文件（不改变导出的公共 API 签名）
- Never: 大幅重构既有流水线、降低安全标准

## Success Criteria（可测试）

1. failureMessages 接入 goose 错误路径 + 测试
2. processor.ts 拆分 ≤400 行/文件，公共导出不变，tests 全绿
3. waitForMergeable 增加总超时 + 测试
4. 陈旧检测函数实现 + 测试
5. webhook 队列持久化 QueueStore + 测试
6. AI Provider 抽象层 + 测试
