# ghbot

> 一个 GitHub Actions 机器人，让 AI 自动审核 Pull Request、分类 Issue、检测重复、回答代码问题、解决冲突、按策略合并。

## 第一性原理：为什么需要 ghbot？

**问题本质**：代码审查是人类协作中最耗时也最容易被跳过的环节。审查者没时间、贡献者等太久、合并后才发现问题——这是所有团队的通用痛点。

**核心矛盾**：代码审查需要"完整理解上下文"和"逐行检查逻辑"，这两件事恰好是当代 LLM 最擅长的；但 LLM 需要被安全地接入到代码仓库的审查流程中，不能直接给它写权限。

**ghbot 的解法**：把 LLM（goose）嵌入到 GitHub Actions 的标准审查流水线中，用 GitHub 自身的权限系统做安全边界，让 AI 只读分析、不写代码、不触碰密钥。审查通过后，是否合并、何时合并、谁批准——仍然由仓库策略决定。

**一句话**：ghbot = 一个能看懂代码的机器人助手，帮你做代码审查的苦活累活，但钥匙在你手里。

---

## 核心功能

### PR 自动审查

goose 的审查结果固定包含四个字段：

- **`review`**：普通审查意见，不强制阻止合并。
- **`change`**：必须修复后才能合并的阻塞性问题。
- **`comment`**：面向 PR 作者的整体评价和总结。
- **`result`**：面向维护者的合并结论、摘要和恶意代码判断。

`change` 在任何策略下都阻止合并。普通 `review` 如何影响合并由 `REVIEW_POLICY` 决定：

| 策略 | 行为 |
|------|------|
| `allow`（默认） | 允许存在普通审查意见，干净时自动 APPROVE |
| `require_approval` | 审查意见不阻止合并，但 `ghbot review` check 保持 `action_required`，需要管理员批准 |
| `reject` | 只要有审查意见就提交 REQUEST_CHANGES 并阻止合并 |

如果模型识别到后门、凭证窃取、恶意持久化、破坏命令或供应链攻击，机器人会评论原因并自动关闭 PR。普通 bug、测试失败或可疑但无法证明恶意的代码不会触发自动关闭。

### Issue/PR 自动分类

在 Issue 或 PR 的 `opened` / `edited` / `reopened` 事件中，ghbot 可以：
- 从配置的白名单中选择并添加标签
- 检测可能的重复项（Issue 只和 Issue 比，PR 只和 PR 比）
- 对高度可能的重复项评论候选链接
- 仅在置信度为 `likely` 时添加 `duplicate` 标签

PR 重复检测分两阶段：先粗筛候选，再细读 commits、评论和 review 做最终判断。

### @bot PR 对话

在 PR 中评论 `@bot` 即可提问。Goose Agent 在一次性 Docker 容器中运行，可以读代码、搜索、执行命令，但拿不到任何密钥，也不能 push。只有 write 及以上权限的用户可触发。

### 自动冲突修复

设置 `AUTO_RESOLVE_CONFLICTS=true` 后，如果 AI 审核通过但 GitHub 报告冲突，goose 可以自动解决。也支持 `/conflict` 命令手动触发。

### 增量审查缓存（Cloudflare R2）

配置 R2 后，每次成功审查的结果会保存到私有的 S3 兼容存储桶。新 commit 触发 `synchronize` 时，goose 会收到旧审查结果和当前完整 diff，增量验证——已修复的问题不再重复报，新 commit 引入的回归单独检查。旧的合并结论不会直接复用。

---

## 快速开始

### 1. 添加 Workflow

调用仓库的默认分支上创建 `.github/workflows/review.yml`：

```yaml
name: ghbot review
on:
  issues:
    types: [opened, edited, reopened]
  pull_request_target:
    types: [opened, edited, reopened, synchronize]
  issue_comment:
    types: [created, edited]
  pull_request_review:
    types: [submitted]
  schedule:
    - cron: "*/30 * * * *"

jobs:
  review:
    uses: lezi-fun/ghbot/.github/workflows/review-reusable.yml@main
    secrets:
      GOOSE_API_KEY: ${{ secrets.GOOSE_API_KEY }}
    permissions:
      contents: write
      pull-requests: write
      issues: write
      checks: write
      statuses: read
```

### 2. 配置环境变量

在仓库的 Settings → Secrets and variables → Actions 中设置：

| 密钥 | 说明 |
|------|------|
| `GOOSE_API_KEY` | OpenAI / 兼容 provider 的 API key |

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `REVIEW_POLICY` | 审查策略：allow / require_approval / reject | `allow` |
| `REVIEW_STRICTNESS` | 严格度：normal / strict | `normal` |
| `REVIEW_BRANCHES` | 目标分支 glob，逗号分隔 | 全部 |
| `AUTO_MERGE` | 是否自动合并通过审查的 PR | `false` |
| `AUTO_RESOLVE_CONFLICTS` | 是否自动解决冲突 | `false` |
| `GOOSE_MODEL` | 使用的模型 | `gpt-5.4` |
| `MAX_PATCH_CHARS` | 发送给模型的最大 patch 字符数 | `120000` |

---

## 开发门禁

所有改动在推送前必须通过：

```bash
npm run typecheck    # TypeScript 严格检查
npm run lint         # ESLint
npm run format:check # Prettier 格式检查
npm test             # 329 个测试，全部通过
npm run build        # 编译到 dist/
```

## 当前版本: v2.0.0

| 指标 | 值 |
|------|------|
| 测试数 | 329 / 329 全绿 |
| 测试文件 | 55 |
| 覆盖率 lines | ~66% |
| 门禁 | typecheck ✅ lint ✅ format ✅ test ✅ build ✅ |

### v2.0 新增

- 智能重试（抖动 + 总超时 + 自定义重试谓词）
- 合并防重入锁（MergeGuard）
- 失败分类与告警（failureMessages）
- 指标收集器（MetricsCollector）
- 陈旧检测（审查期间 head 变化自动追加/丢弃）
- 持久化队列（QueueStore，可选）
- 共享错误工具（消除 5 处重复）
- 完整审计报告 + 关键审查 + 交互式 HTML 报告

---

## 安全设计

- **凭据隔离**：GitHub token、R2 密钥、真实 API key 绝不进入 goose 容器
- **PR 代码不执行**：自动审核只用 API diff，不 checkout 执行 PR 代码
- **快照脱敏**：进入 Agent 工作区的快照排除 .git、.env、凭证文件
- **auto-merge 保持 opt-in**：AUTO_MERGE=false 默认值不可改动
- **推送防护**：fork 推送绑定 SHA 的 force-with-lease

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [docs/SOP.md](docs/SOP.md) | 标准操作流程（开发/部署/排障） |
| [docs/audit-v2-final.md](docs/audit-v2-final.md) | 完整审计报告 |
| [docs/critical-review-v2.md](docs/critical-review-v2.md) | 关键审查（C1-C6 全部修复） |
| [docs/report-v2.html](docs/report-v2.html) | 交互式 HTML 报告（含 10 题测验） |
| [docs/optimization-record.md](docs/optimization-record.md) | 优化验证记录 |
| [docs/SOP.md](docs/SOP.md) | 标准操作流程 |
| [spec/v2-finalization-spec.md](spec/v2-finalization-spec.md) | 规范文档 |
| [tasks/plan.md](tasks/plan.md) | 实施计划 |
| [tasks/todo.md](tasks/todo.md) | 任务清单 |