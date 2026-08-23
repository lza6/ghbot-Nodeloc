# ghbot

[English](README.md)

ghbot 是一个基于 GitHub Actions 和 goose 的仓库机器人，用于审核 Pull Request、分类 Issue/PR、提示可能的重复项、回答 PR 中的代码问题，并可按仓库策略自动合并。

## Pull Request 审核

goose 的审核结果固定包含四个顶层字段：

- `review`：具体但不强制阻止合并的逐行审核意见。
- `change`：合并前必须解决的逐行问题。
- `comment`：面向 PR 作者的整体评价。
- `result`：面向仓库维护者的合并结论、摘要和恶意代码关闭判断。

`change` 在任何策略下都会阻止合并。普通 `review` 如何影响合并由仓库 Actions Variable `REVIEW_POLICY` 决定：

- `allow`：允许存在普通审核意见；没有 `change` 时提交 `APPROVE`。
- `require_approval`：允许存在普通审核意见，但 `ghbot review` check 保持 `action_required`，直到仓库管理员批准当前 head commit。
- `reject`：只要存在普通审核意见就提交 `REQUEST_CHANGES` 并阻止合并。

默认策略是 `allow`。如果模型识别到明确的后门、凭证窃取、恶意持久化、破坏命令或供应链攻击，机器人可以评论原因并自动关闭 PR。普通 bug、测试失败或可疑但无法证明恶意的代码不会触发自动关闭。建议先保持 `AUTO_MERGE=false`，确认审核质量后再开启自动合并。

要让 `require_approval` 或 `reject` 同时阻止人工合并，需要在目标分支的 Ruleset 或 Branch protection 中把 `ghbot review` 设置为 required status check。否则机器人仍会报告 `action_required`，但 GitHub 可能允许有权限的用户手工合并。

## 仓库单独配置

每个使用 ghbot 的仓库可以设置自己的 Actions Variables：

- `REVIEW_INSTRUCTIONS`：该仓库额外的测试、兼容性、架构或发布审核规则。
- `REVIEW_BRANCHES`：需要审核的 PR 目标分支 glob，以逗号分隔；留空表示全部分支。例如 `main,develop,release/**`。
- `REVIEW_STRICTNESS`：默认 `normal`；设为 `strict` 才会全面严格检查。普通模式不吹毛求疵，只报告明确的运行、构建、测试、安全、数据丢失或重要用户体验回归。
- `MAX_PATCH_CHARS`：单次发送给模型的最大 patch 字符数，默认 `120000`。
- `GHBOT_RUNTIME_DIR`：可选的可写 runtime 根目录，用于 `.ghbot-tmp`、`.ghbot-cache` 和仓库知识文件；留空时使用进程工作目录。

`REVIEW_BRANCHES` 匹配 PR 的 base branch。`*` 不跨越 `/`，`**` 可以跨越 `/`。workflow 文件需要存在于仓库默认分支，但这不表示只能审核指向默认分支的 PR；例如 workflow 位于 `main` 时，仍可审核目标为 `develop` 或 `release/1.x` 的 PR。

普通自动审核使用 GitHub API 按 PR 编号读取 metadata、完整文件列表和 diff，不执行不可信 PR 代码。只有显式开启冲突修复时才 checkout PR head，而且执行和测试都在无 GitHub 凭据的一次性净化容器中完成。来自 fork 或没有仓库权限的外部贡献者仍会正常得到自动审核，但不会被自动推送冲突修复。

## Cloudflare R2 增量审核缓存

配置 Cloudflare R2 后，每次成功审核会把以下信息保存到私有存储桶：

- 仓库和 PR 编号
- 已审核的 head SHA 和时间
- 结构化的 `review/change/comment/result` 结果

新 commit 触发 `synchronize` 后，workflow 会恢复该 PR 最新的缓存。goose 同时收到旧审核结果和当前完整 PR diff，重新验证所有旧问题、移除已经修复的问题，并检查新 commit 引入的回归。旧的合并结论不会在没有新审核的情况下直接复用。

每次 `synchronize` 都会先发布一条绑定当前 commit 的“开始审核”进度评论；审核完成、失败，或因为 PR 再次变化而过期时，会更新同一条评论。新审核成功发布后，ghbot 会把旧机器人审核中的逐行 `review` 和 `change` 线程标记为 resolved，并把这些已解决评论折叠隐藏，dismiss 仍然生效的旧审核结论，并把旧审核正文压缩为 superseded 占位说明。如果 GitHub 无法通过 GraphQL 暴露某个旧线程，ghbot 才会删除这条无法映射的逐行评论作为降级处理。GitHub 不允许删除已经提交的 review 记录本身，因此最终只有最新审核保留完整正文和有效状态。

PR 标题、描述或 base branch 变化触发 `edited` 时也会重新审核。对象按仓库 ID 和 PR 编号隔离；`latest.json` 用于加速下一次审核，`reviews/<head-sha>.json` 留存每个成功审核过的 head。关闭或合并 PR 不会主动删除这些对象。缓存不保存 API key、完整 diff 或 prompt。

需要同时配置：

- Actions Secrets：`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`
- Repository Variables：`R2_ENDPOINT`、`R2_BUCKET_NAME`
- 可选 Variable：`R2_PREFIX`，例如 `forum-114614`

建议使用只允许读写这个存储桶对象的专用 R2 Token。ghbot 使用恢复内容前会校验格式以及仓库/PR 身份。R2 密钥只交给宿主进程，不会传入 goose 容器、PR 测试命令或 git 子进程。未配置 R2 或 R2 暂时故障时，审核仍会继续，只是不使用持久历史。

## 可自我改进的仓库认知缓存

ghbot 可以把一份简洁的仓库认知文件保存在同一个私有 R2 存储桶中。它按仓库 ID 隔离，与单个 PR 的审核缓存分开，因此 PR 关闭或合并时不会删除。自动审核可以参考其中长期有效的架构、支持环境、可信测试命令、代码约定和常见坑。

- `REPOSITORY_KNOWLEDGE_ENABLED`：恢复并使用仓库认知，默认 `true`。
- `REPOSITORY_KNOWLEDGE_WRITE`：允许有权限的 `@bot` goose Agent 改进认知缓存，默认 `false`。

Agent 只能编辑临时快照中的 `.ghbot/repository-knowledge.md` 草稿。ghbot 会校验内容，拒绝凭证、私钥和超过 32 KiB 的内容，再把 runtime 副本持久化到按仓库隔离的 R2 对象。它不会提交到业务仓库，Agent 也拿不到 GitHub 或 R2 凭证。

## Issue 和 PR 分类

在 Issue 或 PR 的 `opened`、`edited`、`reopened` 事件中，ghbot 可以：

- 从配置的标签白名单中选择并添加一个或多个标签
- Issue 只和其他 Issue 比较，PR 只和其他 PR 比较
- 对可能或高度可能的重复项评论候选链接和原因
- 仅在置信度为 `likely` 时添加 duplicate 标签

PR 重复检测分成两个阶段：先根据标题和正文粗筛最多 3 个候选，再读取目标 PR 与候选 PR 最近的 commits、conversation comments、review summaries 和 inline review comments 做细查。只有细查结束后才会反馈重复结论。Issue 重复检测仍保持单阶段。

机器人不会自动关闭重复项。重复评论带有隐藏 marker，同一次候选不会在 workflow 重跑时重复发布。人工添加且不属于机器人管理范围的标签会被保留。缺失的配置标签会自动创建。

相关变量：

- `TRIAGE_ENABLED`：是否启用，默认 `true`。
- `TRIAGE_LABELS`：分类标签白名单，默认 `bug,enhancement,documentation,question,maintenance`。
- `TRIAGE_DUPLICATE_LABEL`：重复项标签，默认 `duplicate`。
- `TRIAGE_CANDIDATE_LIMIT`：提供给 goose 的最近同类候选数，默认 `50`，最大 `100`。
- `TRIAGE_INSTRUCTIONS`：该仓库额外的分类规则。

## PR 评论中的 goose Agent

在 PR conversation 中提到 `@bot` 即可询问当前 PR。配置的 `BOT_NAME` 也可以作为 mention；例如 `BOT_NAME=github-actions[bot]` 时，同时识别 `@github-actions` 和 `@github-actions[bot]`。

这个 Agent 启用 goose 内置 Developer 工具，可以在临时工作区中：

- 读取和搜索完整 PR 代码
- 编辑临时文件
- 执行 shell 命令、构建和测试
- 安装依赖并访问网络

因为它可以执行任意命令，只有具有 `write`、`maintain` 或 `admin` 仓库权限的评论者可以触发。该限制只影响 `@bot` 命令 Agent，不影响外部贡献者的自动 PR 审核。如果外部贡献者需要深入排查，maintainer 可以在对方的 PR 中提到 `@bot`，Agent 会分析该贡献者当前的 PR head，并把回答发布到同一个 conversation。

没有上述权限的用户尝试 `@bot`、`/recheck` 或 `/conflict` 时，机器人会公开回复所需权限并提示联系 maintainer，不再静默失败。回复按源评论 ID 去重，workflow 重跑不会重复发送。

Agent 在一次性 Docker 容器中运行：

- PR head checkout 不保存 GitHub credentials。
- 容器只挂载经过净化的 PR 临时快照，不挂载 ghbot runtime 或宿主目录。
- 快照排除 `.git`、`.env*`、符号链接，以及 goose/OpenCode/Codex/Claude/Cursor/Agent 配置和指令文件。
- 容器不会收到 `GITHUB_TOKEN`、GitHub App 凭证或真实 goose API key。
- 一个短期本地代理使用单次随机令牌转发 `/chat/completions`；容器退出后代理立即关闭。
- 容器可以修改临时快照，但不能 commit 或 push；快照在回答后删除。
- 容器受 CPU、内存、进程数和 10 分钟运行时间限制。
- 无论成功、失败还是超时，具名容器都会被强制删除，不会遗留后台任务。

每条回复都按源评论 ID 去重，workflow 重跑不会重复回答；机器人自己的回复会被忽略，避免自触发循环。

Agent 按最新用户评论的语言回复：英文提问使用英文，中文提问使用中文，不会因为 PR 或仓库文件使用另一种语言而切换。

prompt 还会收到由宿主通过 GitHub 验证的请求者上下文：评论者 login、是否为 PR 创建者、仓库权限级别和综合身份分类。它可以据此调整回答方式，但不能绕过安全规则；没有 `write`、`maintain` 或 `admin` 权限的用户仍不会启动带工具的 Agent。

启用认知写入后，Agent 只有发现已验证、长期有效的仓库事实时才能更新草稿。仓库会持续变化，因此当前代码、测试或配置证明旧记录已经过时、被替代、互相冲突或不再成立时，必须主动修改或删除旧条目，而不是只追加历史。不得记录临时 PR 结论、推测、凭证、个人信息或降低安全性的指令；当前仓库证据始终优先于缓存认知。

## 可选的 GitHub App Webhook 模式

Action 模式仍然是默认模式，不需要 Webhook 服务也可以完整使用。`WEBHOOK_ENABLED=false` 是默认值，因此现有 workflow、审核触发器、`/recheck`、`/conflict`、Issue/PR 分类和带工具的 PR 对话都会继续完全通过 GitHub Actions 运行。

只有在同时运行长期 Node 进程或本仓库提供的 `Dockerfile.webhook` 时才启用 Webhook。它接收 GitHub App 的 webhook 事件，处理 Issue/PR conversation comment、review comment 和提交的 review 中对 `@bot` 的提问。适合组织只安装一次 App、由多个仓库共用一个服务端点的场景。App 必须安装到每个目标仓库，或者组织安装时选择包含这些仓库；未被该 installation 授权的仓库无法访问。

GitHub App 的 Webhook URL 配置为 `https://你的域名/webhooks/github`，`WEBHOOK_SECRET` 必须使用独立的长随机 HMAC 密钥，并在 GitHub App Webhook 设置和服务环境中配置相同密钥；不要把公开 URL 当作密钥。并订阅 `Issue comments`、`Pull request review comments`、`Pull request reviews`。App 需要 `Metadata: read`、`Issues: read and write`、`Pull requests: read and write`。服务会使用每个 payload 中的 `installation.id` 换取对应的短期 installation token，不能用一个固定 installation ID 代替所有仓库。

服务环境变量如下：

- `WEBHOOK_ENABLED=true` 才启用，默认 `false`。
- `WEBHOOK_SECRET`，以及可选的 `WEBHOOK_PATH`（默认 `/webhooks/github`）。
- `BOT_NAME`：App 的 login 或 slug，例如 `forumlify[bot]` 同时接受 `@forumlify` 和 `@forumlify[bot]`；`@bot` 始终接受。
- `WEBHOOK_CHAT_PERMISSION`：`read`（默认）、`write` 或 `anyone`。对于组织拥有的仓库，`read` 还会允许组织成员直接提问，不要求把每个成员单独添加为仓库协作者；个人仓库和组织外用户仍走仓库协作者权限检查。`write` 只允许 write、maintain、admin；`anyone` 跳过评论者权限检查，但仍只能访问 App 已安装的仓库。建议给 App 配置组织级 `Members: read`，这样才能验证私有组织成员身份。
- `WEBHOOK_QUEUE_CONCURRENCY` 和 `WEBHOOK_QUEUE_LIMIT` 用于限制后台处理量和内存。

可以用 `npm run build && npm run webhook` 启动，也可以构建并运行 Docker：

```bash
docker build -f Dockerfile.webhook -t ghbot-webhook .
docker run --rm -p 3000:3000 \\
  -e WEBHOOK_ENABLED=true \\
  -e WEBHOOK_SECRET='替换为长随机密钥' \\
  -e GH_APP_ID='123456' \\
  -e GH_APP_PRIVATE_KEY="$GH_APP_PRIVATE_KEY" \\
  -e GOOSE_API_KEY="$GOOSE_API_KEY" \\
  ghbot-webhook
```

TLS 应由反向代理或托管 ingress 终止；Node 服务监听 `PORT`（默认 `3000`）。`GET /healthz` 可作为健康检查，`GET /metrics` 提供 Prometheus 文本指标。服务会先返回 `202` 再后台调用 Goose，因为模型耗时可能超过 GitHub webhook 超时。后台失败只会在进程内重试一次；进程在 `202` 之后崩溃时 GitHub **不会**重投。需要可靠执行 `/recheck`、`/conflict` 和带工具的对话时请用 Action 模式。Webhook 对话是尽力而为。请求使用 HMAC 验签，并按 `X-GitHub-Delivery` 去重。

Webhook 对话刻意保持只读：Goose 只能收到仓库元数据、README、Issue/PR 内容、有限 diff 和近期讨论，不会获得仓库工具或凭证。因此它不能改代码、执行命令、push、运行 `/recheck` 或 `/conflict`；这些操作请继续使用 Action 模式。回复语言跟随最新一条评论，也不会暴露 provider 或 GitHub 密钥。不设置 `WEBHOOK_ENABLED` 就仍是普通的 Action-only 部署。

## 自动解决合并冲突

设置 `AUTO_RESOLVE_CONFLICTS=true` 后，如果 AI 审核已经通过，但 GitHub 报告 `mergeable=false` 且 `mergeable_state=dirty`，goose 可以自动解决冲突。它与 `AUTO_MERGE` 相互独立，因此可以只开启冲突修复而继续禁止自动合并。

具有 `write`、`maintain` 或 `admin` 权限的协作者也可以评论精确命令 `/conflict`，显式要求执行同一套受保护的冲突修复。即使 `AUTO_RESOLVE_CONFLICTS=false`，该命令也可以运行；它不要求先有一次通过的审核，因为修复提交 push 后一定会对新 head 重新完整审核，修复动作本身不会直接批准合并。

自动冲突修复仅处理当前 head 未变化的同仓库 PR。外部 fork 的 `pull_request_target` 仍保持纯 GitHub API 审核，不 checkout 贡献者代码；贡献者启用 **Allow edits from maintainers** 后，maintainer 可以显式评论 `/conflict`，由可信的评论 workflow checkout PR head，并使用绑定已审核 head SHA 的 `--force-with-lease` 推送，因此贡献者新提交的 commit 不会被覆盖。旧 head、非冲突状态、关闭 maintainer edits 和未通过审核的 PR 都会跳过。ghbot 在宿主生成本地 merge，再把无 `.git`、无凭据的净化快照交给 goose。goose 可以修改直接冲突文件，也可以在兼容性确有需要时调整相关调用方、类型、测试、lockfile、配置或文档；受保护的 Agent 配置和凭证路径会被拒绝。

应用改动后，ghbot 检查未合并路径，并且只对 AI 修改过的文件运行 `git diff --check`。配置验证命令后，无凭据容器会以只读方式挂载候选内容，复制到一次性的工作目录，再运行 `CONFLICT_TEST_COMMAND`。基础设施错误会直接报告，不再误交给 goose 当作代码问题修复；只有真实的 merge 相关验证失败才允许一次聚焦修改，随后由宿主权威重跑一次。最后再由不带工具权限的 goose 纯对话调用对完整 staged diff 做只读确认。只有确认返回 `safeToCommit=true`，且远端 PR head 仍与审核 SHA 相同，才会 commit 并 push；同仓库分支普通 push，外部 fork 使用上文所述绑定 SHA 的 force-with-lease。新 commit 会触发 `synchronize` 并重新完整审核，不会把修复前的结论直接当作批准。

## goose 配置

必须添加 Actions Secret（运行审核或 Goose 操作时至少配置一个）：

- `GOOSE_API_KEY`（首选）
- `OPENCODE_API_KEY`（迁移兼容别名）

相关 Repository Variables：

- `GOOSE_BASE_URL`：OpenAI-compatible base URL，默认 `https://api.openai.com/v1`。填写到 `/v1`，不要包含 `/chat/completions`。
- `GOOSE_MODEL`：默认 `gpt-5.4`。
- `GOOSE_THINKING_EFFORT`：可选 `off`、`low`、`medium`、`high`、`max`，workflow 默认 `high`。

workflow 安装固定版本 goose CLI `v1.46.0`。普通审核和分类使用 `GOOSE_MODE=chat`，不加载扩展也不执行工具；通过权限检查的 PR comment Agent，以及冲突修复和最终确认，会在一次性 Docker 容器中启用 Developer 扩展。

迁移期间仍兼容 `OPENCODE_API_KEY`、`OPENCODE_BASE_URL`、`OPENCODE_MODEL`、`OPENCODE_REASONING_EFFORT`，但新仓库应使用 `GOOSE_*` 名称。

## GitHub 认证和权限

workflow 自动获得 `github.token`，无需额外创建名为 `GITHUB_TOKEN` 的仓库 Secret。也可以配置 GitHub App；ghbot 优先使用 App installation token，App 认证失败时回退到 workflow token。

workflow 声明以下权限：

- `contents: write`：可选自动合并和仓库操作。
- `pull-requests: write`：列出 PR、提交 review 和合并。
- `issues: write`：列出 Issue/PR、管理标签和发布评论。
- `checks: write`：发布和更新 `ghbot review` check。
- `statuses: read`：自动合并前检查 commit status。

GitHub App 建议配置以下 Repository permissions：

- Contents：Read and write
- Pull requests：Read and write
- Issues：Read and write
- Checks：Read and write
- Commit statuses：Read-only
- Metadata：Read-only
- Workflows：仅当允许冲突修复修改 workflow 文件时设为 Read and write

可选 App Secrets：

- `GH_APP_ID`
- `GH_APP_PRIVATE_KEY`
- `GH_APP_INSTALLATION_ID`，可省略，ghbot 会按仓库解析 installation

GitHub Actions Secret 和 Variable 名称不能以 `GITHUB_` 开头，所以使用上述 `GH_APP_*` 名称。

GitHub App 和 workflow token 在拥有对应权限时都可以列出 Issue、PR 和标签。R2 缓存与 GitHub App 权限无关，也不会在 PR 关闭时主动删除。

## 在其他仓库中复用

调用仓库的默认分支上需要存在 wrapper workflow。本仓库提供完整示例：[.github/workflows/review.yml](.github/workflows/review.yml)。中央 reusable workflow 为：

```text
lezi-fun/ghbot/.github/workflows/review-reusable.yml@main
```

调用仓库需要转发 `issues`、`pull_request_target`、`issue_comment`、`pull_request_review`，以及可选的 schedule 事件；同时声明前述权限，并传入：

```yaml
secrets:
  GOOSE_API_KEY: ${{ secrets.GOOSE_API_KEY }}
  GH_APP_ID: ${{ secrets.GH_APP_ID }}
  GH_APP_PRIVATE_KEY: ${{ secrets.GH_APP_PRIVATE_KEY }}
  GH_APP_INSTALLATION_ID: ${{ secrets.GH_APP_INSTALLATION_ID }}
  R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
  R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
```

完整的 `with:` 输入和 Repository Variables 映射请参考仓库内的 wrapper workflow。

## 手动重新审核

有资格的仓库用户可以在 PR 中评论：

```text
/recheck
```

机器人会按照仓库当前的 `REVIEW_STRICTNESS` 对最新完整 PR 重新审核。只有具有 `write`、`maintain` 或 `admin` 权限的用户可以触发；旧 `/lenient-check` 命令不再生效。

## 手动解决冲突

有资格的仓库用户可以评论精确命令：

```text
/conflict
```

只有当 GitHub 报告当前开放 PR 存在冲突且 head 可写时才会尝试修复。外部 fork 必须开启 **Allow edits from maintainers**，并通过绑定已审核 SHA 的 force-with-lease 安全更新贡献者分支。它会运行与自动修复相同的可信验证命令和第二次 goose 最终确认；两者成功且远端 head 未变化时才会创建 commit 并 push。

## 开发门禁

所有改动在推送前必须通过本地门禁；CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）在 GitHub 上执行相同检查：

```bash
npm run typecheck    # TypeScript 严格检查
npm run lint         # ESLint（flat config）
npm run format:check # Prettier 格式检查
npm test             # node:test 测试套件
```

可选的 webhook 服务提供 `GET /healthz` 与 `GET /metrics`（Prometheus 文本格式）用于探活与监控。生产硬化变更说明与测验见 [docs/reports/ghbot-production-hardening.html](docs/reports/ghbot-production-hardening.html)。

## 本地开发

需要 Node.js 22 至 25。PR comment Agent 的全工具集成测试还需要可用的 Docker daemon。

```bash
npm install
npm test
npm run typecheck
npm run build
```

本地模拟事件时，先安装 goose CLI `v1.46.0`，按 [.env.example](.env.example) 导出变量，再提供 `GITHUB_EVENT_NAME` 和 `GITHUB_EVENT_PATH`，运行：

```bash
node dist/src/actions/runReview.js
```
