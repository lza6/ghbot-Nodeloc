# Implementation Plan: ghbot v2 终局闭环

## Overview

补齐审计发现的 P1 项，聚焦生产可靠性，不重构既有流水线（遵循"严禁重构"红线），每个改动可独立验证。

## Architecture Decisions

- **不做 processor.ts 大拆分**：用户明确"严禁重构任何文件"，改为增量补强
- **新增模块优先**：新能力用小文件增量实现，不触碰既有导出
- **每项都要测试**：遵循测试驱动开发，每项改动必须有对应测试

## Task List

### Phase 1: 可靠性补强（低风险）

- [ ] Task 1: waitForMergeable 增加总超时 + 测试
- [ ] Task 2: failureMessages 接入 goose 错误路径 + 测试
- [ ] Task 3: MergeGuard 补充近期合并窗口测试 + 接入强化

### Checkpoint: Phase 1

- [ ] npm test 全绿（不破坏既有 321 项）
- [ ] typecheck + lint 通过

### Phase 2: 上游可靠性（中风险）

- [ ] Task 4: 陈旧检测（审查期间 head 变化追加段落后缀） + 测试
- [ ] Task 5: webhook 队列持久化 QueueStore + 测试

### Checkpoint: Phase 2

- [ ] 新增功能测试全绿
- [ ] 既有测试无回归

## Risks and Mitigations

| Risk                       | Impact | Mitigation               |
| -------------------------- | ------ | ------------------------ |
| 引入新依赖                 | Low    | 全部用 Node 内置模块     |
| 改变 MergeGuard 语义       | Low    | 保持现有导出不变         |
| webhook 队列持久化写入失败 | Med    | 降级为内存模式，日志告警 |

## Open Questions

无——按审计证据推进。
