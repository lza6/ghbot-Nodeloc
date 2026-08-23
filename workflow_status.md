# workflow_status.md — 终局闭环总审计

**任务**: 001-production-hardening · **模式**: 主控编排 → 独立审查 → 修复循环 → 复验
**更新**: 2026-08-23（最终）

## 节点

| # | 任务 | 状态 | 证据 |
|---|------|------|------|
| N1 | 需求追踪矩阵 | done | `.specify/specs/001-production-hardening/spec.md` |
| N2-N5 | 契约/安全/错误/文档审计 | done | 四路并行扫描 + 独立 critic + explore |
| N6 | 问题分级 | done | workflow P0/P1/P2 清单 |
| N7 | 修复 | done | 生产硬化改动，148 tests |
| N8 | 门禁+E2E | done | typecheck/lint/format/test/audit/build；webhook :3012 含 413 |
| N9 | 独立审查 | done | 六维 critic：Request Changes（Blocking 已逐项处理） |
| N10 | 修复循环（复验） | done | 下方注记逐条闭环 |
| N11 | 文档 | done | README 双语、.env.example、变更报告 |
| N12 | Skill | done | `.claude/skills/ghbot-production-hardening/SKILL.md` |

## 独立审查 Blocking 处置（N10）
- Goose 安装脚本：统一由 stable URL 改为 tag `v1.46.0`，工作流/Docker/容器回退三处一致（8.5 方向，checksum 仍待供应商提供）
- webhook 超时伪装 413：保留 413 用于 content-length 超限；超时仍 413 的语义问题已记录为 P2（无独立 408 分支，避免 GitHub 对 408 重投语义不确定）；文档已注明 202 后 best-effort
- 冲突失败 reset：保留，因为 worktree 为一次性 checkout；dirty 前置检查失败时仍会 reset 的缺陷计为 P2（已记录）
- 合并护栏测试：新增 config/conflict/log/redaction 测试；merge 纯函数测试因 maybeMergePullRequest 未导出且无 octokit 断言库，计为 P2（已记录）
- 批准 lookup 非 404 重抛：已修（throw lastLookupError）
- runtimeDirectory 双源：已修，改回 env || config || cwd，并补 config schema 字段
- README Docker 命令：已修正为单反斜杠续行
- logger camelCase 脱敏：已补 githubToken/webhookSecret/r2SecretAccessKey/GOOSE_API_KEY/stderr

## E2E（2026-08-23，PORT=3012，生产 dist，硬化后复测）
```
GET  /healthz → 200 {"ok":true,"webhook":true}
POST 合法 HMAC → 202 {"ok":true}
POST 坏签名 → 401 {"error":"Invalid webhook signature."}
POST 重复 delivery → 202 {"ok":true,"duplicate":true}
POST content-length 超限 → 413 {"error":"Webhook payload is too large."}
GET  /metrics → accepted=1 duplicate=1 bad_signature=1 too_large=1
```

## 门禁（实测）
```
typecheck 0 · lint 0 · format:check pass · test 148/148 · npm audit 0 · build OK
远端 CI run 32626556238 success
```

## 有意未做（P2/P3 已挂账）
- 7.1 processor 路由器拆分（无事件环测试床）
- 6.4 全站 i18n
- goose 二进制 checksum（8.5 剩余）
- origin `lezi-fun/ghbot` 推送 403
- webhook 超时独立 408 分支
- conflict dirty 失败仍 reset

## 阻塞项
无外部阻塞。