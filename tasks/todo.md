# Task List: ghbot v2 终局闭环

## Phase 1: 可靠性补强

- [ ] Task 1: waitForMergeable 增加总超时
  - Acceptance: waitForMergeable 在超过 N 秒后返回最新的 PR 状态而非无限轮询
  - Verify: npm test
  - Files: src/review/processor.ts, test/review-processor-extra.test.ts

- [ ] Task 2: failureMessages 接入 goose 错误路径
  - Acceptance: goose 调用失败时使用 categorizeFailure + formatFailureMessage 输出分类文案
  - Verify: npm test
  - Files: src/ai/gooseCli.ts, src/ai/failureMessages.ts, test/goose-cli.test.ts

- [ ] Task 3: MergeGuard 近期合并窗口测试
  - Acceptance: 新增"已尝试过但时间过期"的窗口逻辑测试
  - Verify: npm test
  - Files: src/review/merge-guard.ts, test/merge-guard.test.ts

## Phase 2: 上游可靠性

- [ ] Task 4: 陈旧检测（审查期间 head 变化）
  - Acceptance: 审查返回后 head 变化时，小增量走追加路径，大增量丢弃
  - Verify: npm test
  - Files: src/review/processor.ts + 新增 test/review-stale-detect.test.ts

- [ ] Task 5: webhook 队列持久化 QueueStore
  - Acceptance: QueueStore 可序列化/恢复任务，进程重启不丢
  - Verify: npm test
  - Files: 新增 src/webhook/queueStore.ts + test/queue-store.test.ts

## Final Checkpoint

- [ ] npm run typecheck 通过
- [ ] npm run lint 0 error
- [ ] npm test 全绿（既有 321 + 新增）
- [ ] npm run build 成功
- [ ] 提交 + 推送 + 发行版
