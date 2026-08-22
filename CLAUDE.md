# CLAUDE.md

本文件为 Claude Code 在此仓库工作时提供指导。

## 项目概述

ghbot 是一个基于 GitHub Actions 的机器人，使用 goose CLI（OpenAI 兼容 chat API）完成：

- **PR 审查**：goose 返回固定四段输出（`review` / `change` / `comment` / `result`），只有 `change` 是强制修改；合并策略由 `REVIEW_POLICY` 控制，默认 `allow`
- **Issue/PR 分类**：打标签、两阶段重复检测（PR 先粗筛后详查）
- **PR 评论对话**：`@bot` 提及触发工具型 Agent，在一次性 Docker 容器中分析脱敏快照
- **冲突修复**：`AUTO_RESOLVE_CONFLICTS` 或 `/conflict` 命令，经 goose 确认 `safeToCommit=true` 后才推送
- **可选 webhook 模式**：GitHub App 长驻服务（只读聊天），默认关闭

## 常用命令

```bash
npm install          # 安装依赖
npm run typecheck    # tsc --noEmit，提交前必须通过
npm run build        # 编译到 dist/
npm test             # node:test + tsx，运行全部测试
npm run webhook      # 运行编译后的 webhook 服务
npm run dev:webhook  # tsx 直接运行 webhook 源码
```

无独立 linter/formatter——`typecheck` 和 `test` 是唯一的门禁。

## 技术栈与约定

- **TypeScript ESM**（`"type": "module"`），Node `>=22 <26`，严格模式编译
- **配置**：所有环境变量集中在 `src/config.ts`，用 zod schema 定义并校验；新增配置项必须加进 schema 并补默认值
- **测试**：Node 内置 test runner（`node:test`），测试文件放 `test/*.test.ts`；新行为必须带测试，优先 AAA 结构和描述性命名
- **错误处理**：边界显式处理，不静默吞错；对外输入一律先校验
- **不可变风格**：优先返回新对象而非就地修改
- **日志**：统一用 pino（`src/logger.ts`），禁止 `console.log`

## 架构地图

| 目录                          | 职责                                                                |
| ----------------------------- | ------------------------------------------------------------------- |
| `src/actions/runReview.ts`    | Actions 入口：分发 review/triage/chat/conflict 流程                 |
| `src/config.ts`               | 全部环境变量的 zod schema                                           |
| `src/github/`                 | Octokit 客户端、checks、diff、命令反馈、bot 身份识别                |
| `src/review/`                 | 审查流水线：prompt、策略（policy）、缓存、冲突解决器                |
| `src/chat/`                   | 工具型 @bot 对话（容器隔离）                                        |
| `src/triage/`                 | Issue/PR 分类与重复检测                                             |
| `src/repository/knowledge.ts` | R2 中的仓库知识缓存读写与校验                                       |
| `src/storage/`                | Cloudflare R2 缓存存储层                                            |
| `src/ai/gooseCli.ts`          | goose CLI 封装（chat 模式）；`apiProxy.ts` 为容器提供一次性凭据代理 |
| `src/webhook/`                | 可选 GitHub App webhook 服务与队列                                  |
| `.github/workflows/`          | `review.yml`（调用方包装）与 `review-reusable.yml`（可复用工作流）  |

## 代码检索（graft）

本仓库由 graft 索引，详见 [AGENTS.md](AGENTS.md)。任何理解/定位任务先跑
`graft ask "<问题>" --source` 或 `graft grep "<字面量>"`，不要直接全文件读取；
大改后运行 `graft build` 刷新图。

## 安全红线（CRITICAL）

此仓库处理不受信任的 PR 内容和多种凭据，以下规则不可妥协：

1. **凭据隔离**：GitHub token、App 私钥、R2 密钥、真实 goose API key 绝不进入 goose 容器、PR 快照或 git 子进程环境；容器只拿一次性代理令牌（`src/ai/apiProxy.ts`）
2. **PR 代码执行边界**：自动审查/分类只用 API diff，绝不 checkout 执行 PR 代码；仅冲突修复的验证环节在脱敏一次性容器内运行
3. **快照脱敏**：进入 Agent 工作区的快照必须排除 git 元数据、agent 配置文件（goose/OpenCode 等）、`.env`、符号链接
4. **auto-merge 保持 opt-in**：`AUTO_MERGE=false` 默认值不可改动；恢复缓存审查结果时必须重新完整审查，不得直接复用旧决策
5. **推送防护**：fork 推送必须用 SHA 钉住的 `--force-with-lease`；提交前需 goose 确认 `safeToCommit=true` 且远端 head 未变
6. **知识缓存**：入库前拒绝凭据/私钥内容，限制 32 KiB；Agent 无任何 GitHub/R2 凭据
7. 不在公开 issue 讨论安全漏洞（见 CONTRIBUTING.md）

## Git 工作流

- 提交格式：`<type>: <description>`，类型为 feat / fix / refactor / docs / test / chore / perf / ci（参考现有历史）
- 改动保持聚焦；修改审查或合并逻辑时必须在 PR 中说明行为变化
- 提交前：`npm run typecheck` + `npm test` 全部通过

## 语言说明

代码、注释、commit message 用英文；README 有中英双语版本，改动用户可见行为时同步更新两个 README。
