# ghbot v2.0 最终审计报告

**审计日期**: 2026-08-24
**基准版本**: v1.2.0 (v2.0 半程)
**审计范围**: 全部 src/ (35 文件), test/ (48 文件), 配置, 文档, 工作流
**覆盖率**: lines 66.20% / branches 87.36% / functions 75.57% / 321 tests

---

## 1. 需求追踪矩阵

### 1.1 PR 自动审查

| 需求                                     | 实现位置                                                   | 状态 | 证据                        | 缺口                                                          |
| ---------------------------------------- | ---------------------------------------------------------- | ---- | --------------------------- | ------------------------------------------------------------- |
| 四段输出 (review/change/comment/result)  | `review/gooseReviewer.ts` + `review/normalize.ts`          | ✅   | Zod schema 校验 + 过滤器    | 无                                                            |
| 审查策略 (allow/require_approval/reject) | `review/policy.ts`                                         | ✅   | `evaluateReviewDecision`    | 无                                                            |
| 恶意代码检测并自动关闭                   | `review/processor.ts` → `closeMaliciousPullRequest`        | ✅   | 评论 + 关闭 PR              | 无                                                            |
| 审查结果缓存 (本地)                      | `review/cache.ts`                                          | ✅   | 文件缓存 + 校验             | 无                                                            |
| 审查结果持久化 (R2)                      | `storage/cacheStore.ts`                                    | ✅   | 多版本保存                  | 无                                                            |
| 增量审查 (旧结果复用)                    | `review/processor.ts` → `loadPreviousReview`               | ✅   | 传递到 goose prompt         | **无陈旧检测** — 旧结果只在 LLM prompt 中提及，不做结构性比对 |
| 进度评论                                 | `review/processor.ts` → `begin/finishCommitReviewProgress` | ✅   | 按 commit SHA 标记          | 无                                                            |
| 旧审查清理                               | `review/processor.ts` → `supersedePreviousBotReviews`      | ✅   | GraphQL 解析线程 + minimize | 无                                                            |
| 审查评论回退 (Actions 不能 approve)      | `review/processor.ts` → `shouldFallbackToCommentReview`    | ✅   | 422 检测 + 降级 COMMENT     | 无                                                            |

### 1.2 Issue/PR 分类

| 需求              | 实现位置                                               | 状态 | 证据               | 缺口 |
| ----------------- | ------------------------------------------------------ | ---- | ------------------ | ---- |
| Issue 标签分类    | `triage/processor.ts` → `processIssueTriage`           | ✅   | 单阶段 goose 调用  | 无   |
| PR 标签分类       | `triage/processor.ts` → `processPullRequestTriage`     | ✅   | 两阶段粗筛+详查    | 无   |
| 重复检测 (单阶段) | `triage/processor.ts` → `runSingleStageTriage`         | ✅   | Issue 专用         | 无   |
| 重复检测 (两阶段) | `triage/processor.ts` → `triagePullRequestInTwoStages` | ✅   | 粗筛+证据加载+详查 | 无   |
| 重复评论去重      | `triage/processor.ts` → `postDuplicateFeedback`        | ✅   | 隐藏 HTML marker   | 无   |
| 标签自动创建      | `triage/processor.ts` → `ensureLabelsExist`            | ✅   | 缺则创建           | 无   |

### 1.3 @bot PR 对话

| 需求          | 实现位置                                             | 状态 | 证据                        | 缺口 |
| ------------- | ---------------------------------------------------- | ---- | --------------------------- | ---- |
| @bot 提及检测 | `chat/processor.ts` → `containsBotMention`           | ✅   | 多别名                      | 无   |
| 权限检查      | `chat/processor.ts` → `isTrustedChatPermission`      | ✅   | write/maintain/admin        | 无   |
| 快照脱敏      | `chat/processor.ts` → `createRepositorySnapshot`     | ✅   | 排除 .git + 配置 + 符号链接 | 无   |
| 一次性容器    | `ai/gooseCli.ts` → `runGooseAgent`                   | ✅   | Docker 隔离                 | 无   |
| 凭据代理      | `ai/apiProxy.ts` → `startOneRunApiProxy`             | ✅   | 一次性 token + 时间比较     | 无   |
| 回复去重      | `chat/processor.ts` → `hasExistingReply`             | ✅   | 隐藏 marker                 | 无   |
| 语言跟随      | `chat/processor.ts` → `chatReplyLanguageInstruction` | ✅   | 中英文检测                  | 无   |
| 认知写入      | `chat/processor.ts` + `repository/knowledge.ts`      | ✅   | 快照内 scratch 文件         | 无   |

### 1.4 冲突修复

| 需求         | 实现位置                                                     | 状态 | 证据                            | 缺口                                                                        |
| ------------ | ------------------------------------------------------------ | ---- | ------------------------------- | --------------------------------------------------------------------------- |
| 自动冲突修复 | `review/conflictResolver.ts` → `resolvePullRequestConflicts` | ✅   | 完整流水线                      | 无                                                                          |
| 冲突检测     | `review/conflictResolver.ts` → `canAutoResolveConflicts`     | ✅   | 8 条件判断                      | 无                                                                          |
| Git 操作安全 | `review/conflictResolver.ts` → `buildConflictPushArgs`       | ✅   | 仓库/分支/SHA 安全校验          | 无                                                                          |
| 隔离验证     | `review/conflictResolver.ts` → `runConflictValidation`       | ✅   | 只读 Docker 容器                | 无                                                                          |
| 最终确认     | `review/conflictResolver.ts` → `confirmFinalResolution`      | ✅   | 无工具 goose 只读 + Zod schema  | 无                                                                          |
| 冲突锁       | `review/conflictResolver.ts` → `acquireConflictLock`         | ✅   | 内存 Set 锁                     | **无超时释放** — 如果进程异常退出，锁不会自动释放（内存级，重启后自然消失） |
| 强制推送保护 | `review/conflictResolver.ts` → `buildConflictPushArgs`       | ✅   | `--force-with-lease` + SHA 绑定 | 无                                                                          |

### 1.5 Webhook 模式

| 需求         | 实现位置                                             | 状态 | 证据                          | 缺口                          |
| ------------ | ---------------------------------------------------- | ---- | ----------------------------- | ----------------------------- |
| 签名校验     | `webhook/server.ts` → `verifyGitHubWebhookSignature` | ✅   | HMAC-SHA256 + timingSafeEqual | 无                            |
| 去重         | `webhook/server.ts` → `WebhookTaskQueue`             | ✅   | deliveryId 去重 24h 保留      | 无                            |
| 任务队列     | `webhook/server.ts` → `WebhookTaskQueue`             | ✅   | 并发 + 限流 + 重试 2 次       | **无持久化** — 进程重启丢队列 |
| 指标端点     | `webhook/metrics.ts` → `MetricsRegistry`             | ✅   | Prometheus 格式               | 无                            |
| 只读聊天     | `webhook/processor.ts` → `processWebhookMention`     | ✅   | 无工具 goose                  | 无                            |
| 组织成员权限 | `webhook/processor.ts` → `getCommenterPermission`    | ✅   | orgs.checkMembershipForUser   | 无                            |

### 1.6 仓库认知

| 需求             | 实现位置                                                  | 状态 | 证据                   | 缺口 |
| ---------------- | --------------------------------------------------------- | ---- | ---------------------- | ---- |
| 认知加载         | `repository/knowledge.ts` → `loadRepositoryKnowledge`     | ✅   | 未命中时创建默认模板   | 无   |
| 认知校验         | `repository/knowledge.ts` → `validateRepositoryKnowledge` | ✅   | 32 KiB 限制 + 密钥检测 | 无   |
| 认知持久化       | `storage/cacheStore.ts`                                   | ✅   | R2 写入                | 无   |
| 认知写入 (Agent) | `chat/processor.ts` + `repository/knowledge.ts`           | ✅   | 快照内 scratch 文件    | 无   |

### 1.7 事件路由

| 需求       | 实现位置                                   | 状态 | 证据                           | 缺口 |
| ---------- | ------------------------------------------ | ---- | ------------------------------ | ---- |
| 事件路由   | `actions/router.ts` → `EventRouter`        | ✅   | 注册+分发                      | 无   |
| 三链路隔离 | `actions/router.ts` → `Promise.allSettled` | ✅   | recheck/conflict/chat 互相独立 | 无   |
| 错误汇总   | `actions/router.ts` → `AggregateError`     | ✅   | 多个失败时汇总                 | 无   |

### 1.8 新增模块 (v2.0 半程)

| 需求       | 实现位置                                    | 状态 | 证据                       | 缺口                                   |
| ---------- | ------------------------------------------- | ---- | -------------------------- | -------------------------------------- |
| 合并防重入 | `review/merge-guard.ts` → `MergeGuard`      | ✅   | 100% 测试覆盖              | **未接入 processor.ts** — 有定义无调用 |
| 失败分类   | `ai/failureMessages.ts`                     | ✅   | 100% 测试覆盖              | **未接入生产代码** — 无 import 引用    |
| 指标收集器 | `metrics/collector.ts` → `MetricsCollector` | ✅   | 100% 测试覆盖              | **未接入生产代码** — 无 import 引用    |
| 智能重试   | `retry.ts` → `withRetry`                    | ✅   | 抖动 + 总超时 + 可重试判断 | 无                                     |

---

## 2. 盲点扫描

### 2.1 未覆盖的边界情况

| 编号 | 区域                         | 盲点                                                                                                                                  | 影响                                                       | 优先级 |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ |
| B-01 | `review/processor.ts`        | 没有为 `supersedePreviousBotReviews` 的 GraphQL 调用失败做充分降级                                                                    | 残留旧 inline 评论                                         | P2     |
| B-02 | `review/processor.ts`        | `waitForMergeable` 5 次重试后仍返回 null 时继续处理                                                                                   | 可能错误合并                                               | P1     |
| B-03 | `review/conflictResolver.ts` | `acquireConflictLock` 没有超时机制                                                                                                    | 崩溃后锁残留（内存级，重启即消失，但同进程内可能永久阻塞） | P2     |
| B-04 | `review/conflictResolver.ts` | `buildGooseAgentDockerArgs` 使用 `--add-host host.docker.internal:host-gateway`，但并非所有 Docker 环境支持                           | Linux 上无 dockerd 或不同网络模式时容器内无法连接代理      | P1     |
| B-05 | `chat/processor.ts`          | `createRepositorySnapshot` 使用 `verbatimSymlinks: true` 后过滤符号链接，但 `cp` 递归可能复制大文件                                   | 快照体积不可控                                             | P2     |
| B-06 | `webhook/server.ts`          | `WebhookTaskQueue` 重试 2 次后直接丢弃，不通知外部                                                                                    | 静默丢失 webhook 请求                                      | P2     |
| B-07 | `webhook/processor.ts`       | `loadWebhookContext` 在 `pull_request_review` 事件中不加载 files                                                                      | 对话无 diff 上下文                                         | P2     |
| B-08 | `triage/processor.ts`        | `listCandidates` 不分页，只取第一页 `per_page=100`                                                                                    | 超过 100 个候选时丢失                                      | P2     |
| B-09 | `triage/processor.ts`        | `loadPullRequestEvidence` 每项只取最后 8 条                                                                                           | 证据采样可能不足                                           | P3     |
| B-10 | `review/normalize.ts`        | 只过滤 `path` 不在文件列表和 `line<=0` 的 finding                                                                                     | 不校验 `line` 是否在 patch 有效行范围内                    | P2     |
| B-11 | `review/processor.ts`        | `reviewProgressMarker` 只绑定 commit SHA，不绑定 PR 编号                                                                              | 不同 PR 间可能混淆（scoped 到 PR 内，问题不大）            | P3     |
| B-12 | `review/processor.ts`        | `processScheduledPendingMerges` 对 PR 分页只取 `per_page=100` 无后续分页                                                              | 超过 100 个开放 PR 时遗漏                                  | P2     |
| B-13 | `review/processor.ts`        | `hasCurrentHeadApprovalFrom` 的权限检查循环中，第一次失败后继续尝试，但最后如果所有都失败抛出最后一个错误                             | 一个查询失败可能掩盖其他成功                               | P2     |
| B-14 | `review/processor.ts`        | `processRecheckComment` 和 `processConflictComment` 在 `getCollaboratorPermissionLevel` 404 时返回 `permission: null`，然后无权限回复 | 外部协作者降级正确                                         | P3     |
| B-15 | `review/conflictResolver.ts` | `buildCommandEnvironment` 中的 `SHELL` 环境变量直接传递                                                                               | 可能影响容器内行为                                         | P3     |

### 2.2 错误路径

| 编号 | 区域                         | 错误路径                                              | 当前处理                            | 改进建议                          |
| ---- | ---------------------------- | ----------------------------------------------------- | ----------------------------------- | --------------------------------- |
| E-01 | `review/processor.ts`        | `createGitHubReview` 提交失败后只做一次 fallback      | 降级到 COMMENT 但仍在同一事件中继续 | 可考虑重试                        |
| E-02 | `review/processor.ts`        | `supersedePreviousBotReviews` 中部分 GraphQL 调用失败 | 日志 warn 后继续                    | 正确                              |
| E-03 | `ai/gooseCli.ts`             | Docker 容器创建失败                                   | 抛出异常                            | 正确                              |
| E-04 | `ai/gooseCli.ts`             | goose 输出超过 1M 字符                                | 截断末尾 + 抛出 error               | 极端情况应降级而非整体失败        |
| E-05 | `ai/gooseCli.ts`             | `resolveHostGooseBinary` 在非 Linux 上返回 undefined  | 容器内从网络下载                    | 非 Linux 环境无法使用，需文档说明 |
| E-06 | `review/conflictResolver.ts` | `parseFinalConfirmation` 解析失败                     | 抛出异常                            | 正确（不提交不安全结果）          |
| E-07 | `review/conflictResolver.ts` | `runCommandAllowFailure` 超时后 SIGTERM+5s SIGKILL    | 合理                                | 正确                              |
| E-08 | `chat/processor.ts`          | `createRepositorySnapshot` 复制失败                   | 清理快照后抛出                      | 正确                              |

### 2.3 安全风险

| 编号 | 风险                                                                                                               | 位置                            | 严重程度 | 说明                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------- | ----------------------------------------------------------------- |
| S-01 | `sanitization.ts` 未排除 `.npmrc`、`terraform/`、`kube/`、`docker/` 配置                                           | 全局                            | P2       | 这些文件可能包含注册表令牌或云凭据                                |
| S-02 | `apiProxy.ts` 中 `timingSafeEqual` 对比：`Buffer.from(suppliedToken)` 可能因编码抛出异常                           | `apiProxy.ts:131`               | P2       | 调用方应确保 `suppliedToken` 是 ASCII，但未显式处理               |
| S-03 | `webhook/server.ts` `readRawBody` 中 `for await...of` 可能被慢速请求阻塞                                           | `webhook/server.ts:98`          | P1       | 已有 body 30s 超时，但 `readRawBody` 内部无超时                   |
| S-04 | `gooseCli.ts` 在 `runGoosePrompt` 中直接将 `config.gooseApiKey` 设为环境变量 `OPENAI_API_KEY`                      | `gooseCli.ts:408`               | P1       | 子进程环境变量可能通过 `/proc` 或其他方式泄露到同一宿主的不同进程 |
| S-05 | `review/conflictResolver.ts` `askpass.sh` 中 `GHBOT_GIT_TOKEN` 通过环境变量传递                                    | `conflictResolver.ts:139`       | P1       | askpass 脚本在子进程环境中，Git 子进程可能继承此变量              |
| S-06 | `review/conflictResolver.ts` `buildCommandEnvironment` 传递 `NODE_EXTRA_CA_CERTS`、`SSL_CERT_FILE`、`SSL_CERT_DIR` | `conflictResolver.ts:1237-1240` | P2       | 可能绕过证书验证                                                  |

---

## 3. P0/P1/P2/P3 问题清单

### P0 (阻塞)

| ID    | 问题 | 位置 | 说明                                   |
| ----- | ---- | ---- | -------------------------------------- |
| P0-01 | 无   | —    | 构建、类型检查、测试全部通过，无阻塞项 |

### P1 (高)

| ID    | 问题                              | 位置                            | 说明                                                                                        |
| ----- | --------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| P1-01 | `MergeGuard` 未接入生产代码       | `review/merge-guard.ts`         | 定义了 `MergeGuard` 类，但 processor.ts 中 `maybeMergePullRequest` 未调用，无实际防重入效果 |
| P1-02 | `failureMessages` 未接入生产代码  | `ai/failureMessages.ts`         | 定义了 `categorizeFailure` / `formatFailureMessage`，但无任何模块调用                       |
| P1-03 | `MetricsCollector` 未接入生产代码 | `metrics/collector.ts`          | 定义了完整指标收集器，但 `src/actions/runReview.ts` 和 `review/processor.ts` 未调用         |
| P1-04 | `processor.ts` 1736 行            | `review/processor.ts`           | 远超 800 行上限，核心编排逻辑难以维护和测试                                                 |
| P1-05 | `conflictResolver.ts` 1250 行     | `review/conflictResolver.ts`    | 远超 800 行上限，包含多个独立职责                                                           |
| P1-06 | coverage 不足                     | 全局                            | lines 66.20% 远低于 80% 目标；`processor.ts` 49.42%、`triage/processor.ts` 63.19%           |
| P1-07 | `waitForMergeable` 无超时约束     | `review/processor.ts:1411-1432` | 5 次重试 1s 间隔，无总超时，可能无限等待                                                    |
| P1-08 | 审查运行期间无陈旧检测            | `review/processor.ts:98-105`    | LLM 运行期间 head 变化时丢弃结果，浪费完整调用                                              |

### P2 (中)

| ID    | 问题                                                             | 位置                           | 说明                                                     |
| ----- | ---------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| P2-01 | 快照排除清单不完整                                               | `security/sanitization.ts`     | 缺少 `.npmrc`、`terraform/`、`kube/`、`docker/` 配置路径 |
| P2-02 | webhook 队列无持久化                                             | `webhook/server.ts`            | 进程重启丢失所有待处理任务                               |
| P2-03 | `processScheduledPendingMerges` 不分页                           | `review/processor.ts:279-284`  | 只取 100 条 PR，超过时遗漏                               |
| P2-04 | `triage/processor.ts` `listCandidates` 不分页                    | `triage/processor.ts:291-332`  | 只取 100 条，超过时遗漏                                  |
| P2-05 | `webhook/processor.ts` 对 `pull_request_review` 事件不加载 files | `webhook/processor.ts:309-317` | 对话无 diff 上下文                                       |
| P2-06 | `review/normalize.ts` 不校验 line 有效性                         | `review/normalize.ts:32-33`    | 只校验 `line>0`，不校验是否在 patch 有效行范围内         |
| P2-07 | `apiProxy.ts` 中 `Buffer.from(suppliedToken)` 可能抛出异常       | `apiProxy.ts:131`              | 未处理非 ASCII token 的编码异常                          |
| P2-08 | `gooseCli.ts` 中 `OPENAI_API_KEY` 暴露到子进程环境               | `gooseCli.ts:408`              | 可能通过 `/proc/PID/environ` 泄露                        |
| P2-09 | `conflictResolver.ts` 中 `GHBOT_GIT_TOKEN` 通过环境变量传递      | `conflictResolver.ts:139`      | git 子进程可读取此环境变量                               |
| P2-10 | 日志中 `err.stderr` 被 redact 但 `error.stderr` 保留             | `logger.ts:33-34`              | 不一致的 redact 模式                                     |

### P3 (低)

| ID    | 问题                                                             | 位置                               | 说明                       |
| ----- | ---------------------------------------------------------------- | ---------------------------------- | -------------------------- |
| P3-01 | 无分片并行审查                                                   | `review/processor.ts`              | 大 PR 串行 LLM 调用延迟高  |
| P3-02 | 无 AI Provider 抽象层                                            | `ai/gooseCli.ts`                   | 换 provider 需大改         |
| P3-03 | 审查结果无去重                                                   | `review/gooseReviewer.ts`          | 相似 finding 刷屏          |
| P3-04 | 审查结果无自检                                                   | `review/gooseReviewer.ts`          | 矛盾/低质量结果无检查      |
| P3-05 | 无国际化                                                         | 全局                               | 所有评论英文写死           |
| P3-06 | `conflictResolver.ts` 冲突锁无超时                               | `review/conflictResolver.ts:71-79` | 同进程内永久阻塞风险       |
| P3-07 | `ci.yml` 无覆盖率门槛                                            | `.github/workflows/ci.yml`         | 覆盖率下降不会被阻止       |
| P3-08 | 无预提交 hook                                                    | 项目根                             | 无 husky/lint-staged       |
| P3-09 | 版本号管理在 `package.json` 但无自动 changelog                   | —                                  | 需手动更新                 |
| P3-10 | `ci.yml` 中 `npm ci` 未使用 `--production` 或 `--ignore-scripts` | —                                  | 构建时执行所有生命周期脚本 |

---

## 4. 架构评审

### 4.1 模块边界

```
actions/          ← 入口层 (router + runReview)
  ├── router.ts      ← 事件路由注册 + 分发
  └── runReview.ts   ← Actions 入口 + payload 构建
review/            ← 审查核心（最大模块）
  ├── processor.ts  ← 1736 行 — 含 7+ 职责
  ├── conflictResolver.ts ← 1250 行 — 含 5+ 职责
  ├── gooseReviewer.ts ← 审查 prompt + schema
  ├── normalize.ts     ← 结果净化
  ├── format.ts        ← 评论格式化
  ├── policy.ts        ← 策略 + 状态标记
  ├── cache.ts         ← 本地缓存
  ├── prompt.ts        ← patch 截断
  └── merge-guard.ts   ← 未接入
ai/                ← AI 调用层
  ├── gooseCli.ts   ← 726 行 — 3 种运行模式混用
  ├── apiProxy.ts   ← 一次性凭据代理
  └── failureMessages.ts ← 未接入
chat/              ← @bot 对话
  └── processor.ts  ← 358 行
triage/            ← 分类
  └── processor.ts  ← 576 行
github/            ← GitHub API 封装
  ├── client.ts     ← 认证
  ├── checks.ts     ← 状态检查
  ├── diff.ts       ← 行号解析
  ├── commandFeedback.ts ← 命令反馈
  ├── botIdentity.ts     ← 显示名
  └── pulls.ts      ← 文件列表
webhook/           ← 可选 webhook 服务
  ├── server.ts    ← 315 行
  ├── processor.ts ← 518 行
  └── metrics.ts   ← 59 行
storage/           ← 持久化
  ├── r2.ts        ← S3 客户端
  └── cacheStore.ts ← 缓存编排
security/          ← 安全
  ├── sanitization.ts ← 路径排除
  └── secrets.ts      ← 密钥脱敏
repository/        ← 仓库认知
  └── knowledge.ts
metrics/           ← 指标
  └── collector.ts ← 未接入
```

### 4.2 关键架构问题

| 问题                                              | 严重程度 | 说明                                                                                                                                                           |
| ------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review/processor.ts` 承担过多职责                | P1       | 1736 行：编排、进度、提交、check run、旧审查清理、合并、审批、评论命令                                                                                         |
| `review/conflictResolver.ts` 5 种职责混合         | P1       | 1250 行：冲突检测、git 操作、快照管理、diff 检查、验证、确认                                                                                                   |
| 3 个新模块无生产引用                              | P1       | `MergeGuard`、`failureMessages`、`MetricsCollector` 均有定义和测试但未引入                                                                                     |
| `ai/gooseCli.ts` 3 种运行模式耦合                 | P2       | `runGoosePrompt`（chat）、`runGooseAgent`（Docker + Developer）、`runIsolatedWorkspaceCommand`（验证）在同一个文件中                                           |
| 认证逻辑分散                                      | P2       | `github/client.ts` 处理两种认证（token + App），但 webhook 另有 `createGitHubAppInstallationCredentials`，`runReview.ts` 中 `createGitHubCredentials` 再次处理 |
| 错误处理模式不一致                                | P2       | 部分 `catch` 中 `logger.warn` 后继续，部分 `catch` 后 `throw`，无统一策略                                                                                      |
| `withRetry` 在不同调用处使用不同的 label 命名规则 | P3       | 有的用 `github.issues.createComment.*`，有的用 `goose.run.*`，无统一 namespace                                                                                 |

### 4.3 设计模式评价

| 模式                   | 位置                                            | 评价                                                                                  |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| EventRouter (策略模式) | `actions/router.ts`                             | 良好：注册式分发，可扩展                                                              |
| 快照模式 (Snapshot)    | `review/conflictResolver.ts`                    | 良好：`inventorySnapshot` + `diffSnapshotInventories` + `applySnapshotChanges` 三阶段 |
| 仓储模式 (Repository)  | `storage/r2.ts`                                 | 一般：`downloadR2Object`/`uploadR2Object` 是过程式，非接口抽象                        |
| 代理模式 (Proxy)       | `ai/apiProxy.ts`                                | 良好：一次性 token 认证                                                               |
| 工厂模式               | `actions/router.ts` → `buildDefaultEventRouter` | 良好：集中注册                                                                        |
| 单例模式               | `logger.ts`、`metrics/collector.ts`             | 适当：全局状态合理                                                                    |
| MergeGuard 防重入      | `review/merge-guard.ts`                         | 未接入：已定义但无调用                                                                |

---

## 5. 性能评审

### 5.1 重试策略

| 方面                          | 评价                         | 改进建议           |
| ----------------------------- | ---------------------------- | ------------------ |
| `withRetry` 已实现智能重试    | ✅ 抖动 + 分类 + 总超时      | 已落地 (M1-1)      |
| 默认 5 次重试 + 1s base delay | 合理                         | 可接受             |
| 4xx 非重试逻辑                | 正确                         | 无                 |
| 总超时退出                    | 正确                         | 无                 |
| gobose 调用 3 次重试          | `review/gooseReviewer.ts:63` | 合理，LLM 调用昂贵 |

### 5.2 缓存策略

| 方面          | 评价                      | 改进建议                                                  |
| ------------- | ------------------------- | --------------------------------------------------------- |
| 本地审查缓存  | ✅ 文件级缓存 + Zod 校验  | 无                                                        |
| R2 持久化缓存 | ✅ 多版本 + 身份校验      | 无                                                        |
| 仓库认知缓存  | ✅ 32 KiB 限制 + 密钥检测 | 可增加版本管理/淘汰                                       |
| 缓存预热      | ❌ 无预热                 | `loadPreviousReview` 和 `restorePersistentCache` 串行等待 |
| 审查差异分析  | ❌ 无差异复用             | 每次 `synchronize` 全量审查                               |

### 5.3 并发处理

| 方面         | 评价                               | 改进建议            |
| ------------ | ---------------------------------- | ------------------- |
| 事件路由并行 | ✅ `Promise.allSettled` 三链路隔离 | 无                  |
| webhook 队列 | ✅ 并发控制 + 限流                 | 可加持久化          |
| 冲突锁       | ✅ 内存 Set 锁                     | 可加超时            |
| 合并防重入   | ❌ `MergeGuard` 未接入             | 需接入 processor.ts |
| 分片审查     | ❌ 无并行 LLM 审查                 | 大 PR 延迟高        |

### 5.4 内存与资源

| 方面                 | 评价                         |
| -------------------- | ---------------------------- |
| ECD 容器内存限制 4GB | 合理                         |
| ECD 容器 CPU 2 核    | 合理                         |
| 进程数限制 512       | 合理                         |
| 输出截断 1M 字符     | 合理                         |
| 快照大小无限制       | 风险：大仓库可能复制大量文件 |
| webhook 队列内存     | 有限流 `queueLimit=500`      |

---

## 6. 安全评审

### 6.1 密钥处理

| 密钥            | 位置                      | 处理方式                         | 评价                  |
| --------------- | ------------------------- | -------------------------------- | --------------------- |
| `GOOSE_API_KEY` | `config.ts`               | Zod schema 读取环境变量          | ✅                    |
| `GITHUB_TOKEN`  | `config.ts`               | 直接从 process.env 读取          | ✅                    |
| GitHub App 私钥 | `config.ts` → `client.ts` | `normalizePrivateKey` 处理 `\\n` | ✅                    |
| R2 密钥         | `config.ts`               | 四件套校验                       | ✅                    |
| 容器内 API key  | `apiProxy.ts`             | 一次性随机 token 替代            | ✅                    |
| Git token       | `conflictResolver.ts`     | `GIT_ASKPASS` 脚本中写入         | ⚠️ 子进程环境变量可读 |

### 6.2 注入防护

| 防护           | 位置                                             | 评价                               |
| -------------- | ------------------------------------------------ | ---------------------------------- |
| 路径跨越防护   | `conflictResolver.ts` → `safeFilePath`           | ✅ 双重检查                        |
| 分支名安全校验 | `conflictResolver.ts` → `isSafeGitBranch`        | ✅ 控制字符排除                    |
| 仓库名安全校验 | `conflictResolver.ts` → `isSafeGitHubRepository` | ✅ 正则白名单                      |
| 快照排除       | `chat/processor.ts` → `createRepositorySnapshot` | ⚠️ `.npmrc`、`terraform/` 等未覆盖 |
| 路径保护       | `security/sanitization.ts`                       | ✅ 集中式清单                      |
| 密钥脱敏       | `security/secrets.ts`                            | ✅ 正则匹配                        |
| 日志 redact    | `logger.ts`                                      | ✅ pino redact 配置                |

### 6.3 脱敏覆盖

| 路径/模式                              | 已覆盖 | 缺漏                                                                              |
| -------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| GitHub PAT (ghp_...)                   | ✅     | —                                                                                 |
| GitHub PAT v2 (github_pat_)            | ✅     | —                                                                                 |
| OpenAI API key (sk-...)                | ✅     | —                                                                                 |
| Bearer token                           | ✅     | —                                                                                 |
| 私钥 (-----BEGIN ... PRIVATE KEY-----) | ✅     | —                                                                                 |
| SSH 私钥                               | ❌     | `-----BEGIN OPENSSH PRIVATE KEY-----` 未匹配（`BEGIN [A-Z ]*PRIVATE KEY` 已覆盖） | ✅  |
| 日志 redact 路径                       | ✅     | `err.stderr` vs `error.stderr` 不一致 (P2-10)                                     |

### 6.4 安全评估总结

| 领域       | 评级 | 要点                             |
| ---------- | ---- | -------------------------------- |
| 凭据隔离   | A    | 容器内无真实凭据，一次性代理安全 |
| 注入防护   | A    | 路径/分支/仓库名白名单校验完善   |
| 快照脱敏   | B+   | 主要路径已覆盖，缺 `.npmrc` 等   |
| 密钥脱敏   | A    | 正则 + 日志 redact 双保险        |
| 子进程安全 | B    | 环境变量泄露风险较低但有         |
| 整体安全   | A-   | 生产级安全实践，无重大漏洞       |

---

## 7. 测试评审

### 7.1 覆盖缺口

| 模块                         | 当前 lines | 目标 | 主要缺口                                                                                                                                                                            |
| ---------------------------- | ---------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review/processor.ts`        | 49.42%     | ≥80% | `processPullRequest` 主流程、`supersedePreviousBotReviews` 大段、`maybeMergePullRequest` 大部分、`processScheduledPendingMerges`、`processRecheckComment`、`processConflictComment` |
| `review/conflictResolver.ts` | 57.52%     | ≥80% | `resolvePullRequestConflicts` 主流程、`buildConflictPrompt`、`buildValidationRepairPrompt`、`runConflictValidation`、`runCommand`                                                   |
| `triage/processor.ts`        | 63.19%     | ≥80% | `processTriage` 主流程、`triagePullRequestInTwoStages` 大部分、`ensureLabelsExist`、`postDuplicateFeedback`                                                                         |
| `webhook/processor.ts`       | 72.39%     | ≥80% | `processWebhookMention` 主流程、`loadWebhookContext` 大部分、`getCommenterPermission` 组织成员分支                                                                                  |
| `webhook/server.ts`          | 75.87%     | ≥80% | `createWebhookServer` 队列满 503、body 超时 413、`startWebhookServer` 完整流程                                                                                                      |
| `storage/cacheStore.ts`      | 95.73%     | ≥95% | 剩余少量行                                                                                                                                                                          |

### 7.2 测试质量

| 维度       | 评价                                     |
| ---------- | ---------------------------------------- |
| 测试结构   | ✅ AAA 模式统一使用                      |
| 测试命名   | ✅ 描述性命名                            |
| Mock 使用  | ✅ 无真实 LLM/HTTP 调用                  |
| 边界测试   | ⚠️ 部分模块有边界但不足                  |
| 集成测试   | ❌ 无集成测试 (test/integration/ 不存在) |
| E2E 测试   | ❌ 无 E2E 测试                           |
| 覆盖率门禁 | ❌ `ci.yml` 未设置覆盖率阈值             |

### 7.3 测试文件增长

| 指标             | v1.2.0 | 当前   | 增长   |
| ---------------- | ------ | ------ | ------ |
| 测试文件         | 36     | 48     | +12    |
| 测试数           | 151    | 321    | +170   |
| 覆盖率 lines     | 61.41% | 66.20% | +4.79% |
| 覆盖率 branches  | 82.98% | 87.36% | +4.38% |
| 覆盖率 functions | 69.97% | 75.57% | +5.60% |

### 7.4 测试缺口详细分析

**processor.ts 核心缺口:**

```typescript
// 未测试的极端路径：
- processPullRequest 中 draft/skip 跳过 → 正确跳过
- processPullRequest 中恶意代码关闭 → closeMaliciousPullRequest
- submitReview 中 file 不存在 → unpostedFindings
- createGitHubReview 中 422 回退 → COMMENT
- upsertReviewCheckRun 中 malice/requireAdmin 不同结论
- waitForMergeable 5 次后 null 返回
- mergeable_state=dirty 时冲突修复
- schedule 中已合并 PR 的跳过
- hasCurrentHeadApprovalFrom 中 404 处理
- processRecheckComment 中权限不足
- processConflictComment 中非 dirty 状态跳过
```

**conflictResolver.ts 核心缺口:**

```typescript
- resolvePullRequestConflicts 主流程中任何分支失败
- buildConflictPrompt 中 validationCommand 有无分支
- buildValidationRepairPrompt 完整文本
- runConflictValidation 中基础设施失败分类
- remainingConflictTime 超时抛出
- commandFailureOutput 中 redactSecrets 接线
- buildCommandEnvironment 中 PROXY 环境变量传递
```

---

## 8. 文档评审

### 8.1 README 一致性

| 对比项          | README.md | README-zh.md | 一致性 |
| --------------- | --------- | ------------ | ------ |
| PR 审查四段输出 | ✅        | ✅           | 一致   |
| 审查策略        | ✅        | ✅           | 一致   |
| 增量缓存        | ✅        | ✅           | 一致   |
| 仓库认知        | ✅        | ✅           | 一致   |
| Issue/PR 分类   | ✅        | ✅           | 一致   |
| @bot 对话       | ✅        | ✅           | 一致   |
| Webhook 模式    | ✅        | ✅           | 一致   |
| 冲突修复        | ✅        | ✅           | 一致   |
| goose 配置      | ✅        | ✅           | 一致   |
| 开发门禁        | ✅        | ✅           | 一致   |
| 本地开发        | ✅        | ✅           | 一致   |

### 8.2 配置文档

| 配置项                       | `.env.example` | README | 代码中 `config.ts` | 一致性             |
| ---------------------------- | -------------- | ------ | ------------------ | ------------------ |
| PORT                         | ✅             | ✅     | ✅                 | 一致               |
| LOG_LEVEL                    | ✅             | ❌     | ✅                 | 未在 README 文档化 |
| GHBOT_RUNTIME_DIR            | ✅             | ✅     | ✅                 | 一致               |
| GOOSE_API_KEY                | ✅             | ✅     | ✅                 | 一致               |
| GOOSE_BASE_URL               | ✅             | ✅     | ✅                 | 一致               |
| GOOSE_MODEL                  | ✅             | ✅     | ✅                 | 一致               |
| GOOSE_THINKING_EFFORT        | ✅             | ✅     | ✅                 | 一致               |
| REVIEW_POLICY                | ✅             | ✅     | ✅                 | 一致               |
| REVIEW_STRICTNESS            | ✅             | ✅     | ✅                 | 一致               |
| REVIEW_INSTRUCTIONS          | ✅             | ✅     | ✅                 | 一致               |
| REVIEW_BRANCHES              | ✅             | ✅     | ✅                 | 一致               |
| R2 配置                      | ✅             | ✅     | ✅                 | 一致               |
| TRIAGE 配置                  | ✅             | ✅     | ✅                 | 一致               |
| AUTO_MERGE                   | ✅             | ✅     | ✅                 | 一致               |
| AUTO_RESOLVE_CONFLICTS       | ✅             | ✅     | ✅                 | 一致               |
| CONFLICT_TEST_COMMAND        | ✅             | ✅     | ✅                 | 一致               |
| MERGE_METHOD                 | ✅             | ✅     | ✅                 | 一致               |
| REQUIRE_CHECKS               | ✅             | ✅     | ✅                 | 一致               |
| MAX_PATCH_CHARS              | ✅             | ✅     | ✅                 | 一致               |
| BOT_NAME                     | ✅             | ✅     | ✅                 | 一致               |
| WEBHOOK 配置                 | ✅             | ✅     | ✅                 | 一致               |
| REPOSITORY_KNOWLEDGE_ENABLED | ✅             | ✅     | ✅                 | 一致               |
| REPOSITORY_KNOWLEDGE_WRITE   | ✅             | ✅     | ✅                 | 一致               |

### 8.3 文档缺漏

| 缺漏                                                    | 说明                                    | 优先级 |
| ------------------------------------------------------- | --------------------------------------- | ------ |
| `LOG_LEVEL` 未在 README 文档化                          | 仅在 `.env.example` 和 `config.ts` 中有 | P3     |
| `workflow_status.md` 未同步最新状态                     | 标记了"未落地项"但未更新为当前实际状态  | P2     |
| 无 CHANGELOG                                            | 版本迭代无历史记录                      | P3     |
| 无 CONTRIBUTING.md 详细指南                             | 仅有安全红线在 README 中提及            | P3     |
| `docs/reports/ghbot-production-hardening.html` 外部依赖 | 文档链接指向外部文件                    | P3     |

### 8.4 部署文档

| 部署方式                | 文档化 | 评价                          |
| ----------------------- | ------ | ----------------------------- |
| GitHub Actions (主模式) | ✅     | 详细                          |
| Webhook Docker 部署     | ✅     | 详细                          |
| 本地开发                | ✅     | 详细                          |
| CI/CD 流水线            | ✅     | 有 `.github/workflows/ci.yml` |

---

## 9. 汇总建议

### 立即修复 (P1)

1. 将 `MergeGuard`、`failureMessages`、`MetricsCollector` 接入生产代码
2. 拆分 `review/processor.ts` (1736 行) 和 `review/conflictResolver.ts` (1250 行) 为 ≤400 行模块
3. 补齐 `processor.ts` 和 `conflictResolver.ts` 的测试覆盖率至 ≥80%
4. 为 `waitForMergeable` 增加总超时约束
5. 实现审查运行期间陈旧检测 (追加段落后缀合并审查)

### 短期改进 (P2)

6. 完善 `sanitization.ts` 排除清单 (`.npmrc`、`terraform/`、`kube/`、`docker/` 配置)
7. webhook 队列增加持久化能力
8. 修复 `logger.ts` 中 `err.stderr` vs `error.stderr` 不一致
9. 为 `triage/processor.ts` `listCandidates` 增加分页支持
10. 在 `normalize.ts` 中增加 patch 有效行校验

### 长期演进 (P3+)

11. 实现分片并行审查 (Sharded Review)
12. 实现 AI Provider 抽象层 (`ChatProvider` 接口)
13. 实现审查结果去重与自检
14. 实现国际化支持
15. 实现审查历史学习与自适应严格度
16. 在 CI 中设置覆盖率门槛 (≥80%)
17. 添加预提交 hook (husky + lint-staged)
18. 实现自动 changelog 生成

---

## 附录 A: 文件行数统计 (35 源文件 + 48 测试文件)

| 排名 | 文件                           | 行数 | 覆盖   | 需关注             |
| ---- | ------------------------------ | ---- | ------ | ------------------ |
| 1    | src/review/processor.ts        | 1736 | 49.42% | 🔴 大文件 + 低覆盖 |
| 2    | src/review/conflictResolver.ts | 1250 | 57.52% | 🔴 大文件 + 低覆盖 |
| 3    | src/ai/gooseCli.ts             | 726  | 73.07% | 🟡 3 种模式耦合    |
| 4    | src/triage/processor.ts        | 576  | 63.19% | 🟡 低覆盖          |
| 5    | src/webhook/processor.ts       | 518  | 72.39% | 🟡 中覆盖          |
| 6    | src/webhook/server.ts          | 315  | 75.87% | 🟡 中覆盖          |
| 7    | src/actions/router.ts          | 361  | 94.16% | ✅                 |
| 8    | src/chat/processor.ts          | 358  | 93.82% | ✅                 |
| 9    | src/actions/runReview.ts       | 293  | 93.52% | ✅                 |
| 10   | src/storage/cacheStore.ts      | 234  | 95.73% | ✅                 |

## 附录 B: 测试文件清单 (48 文件 / 321 测试)

测试全部通过。覆盖率 lines 66.20% / branches 87.36% / functions 75.57%。
