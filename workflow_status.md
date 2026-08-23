# workflow_status.md — 终局闭环总审计

**任务**: 001-production-hardening
**更新**: 2026-08-23

## 节点

| # | 任务 | 状态 | 证据 |
|---|------|------|------|
| N1 | 需求追踪矩阵 | done | `.specify/specs/001-production-hardening/spec.md` |
| N2-N5 | 契约/安全/错误/文档审计 | done | 四路扫描 + 主线程复核 |
| N6 | 问题分级 | done | 本文件 P0/P1 列表 |
| N7 | 修复 | done | 工作区生产硬化改动 + 148 tests |
| N8 | 门禁+E2E | done | typecheck/lint/format/test/audit/build；webhook :3011 HTTP 冒烟 |
| N9 | 独立审查 | in_progress | 后台 critic/explorer；Artifact 发布因 ANTHROPIC_AUTH_TOKEN 不可用 |
| N10 | 修复循环 | pending | 等 critic 阻塞项 |
| N11 | 文档 | done | README 双语、.env.example、HTML 报告本地文件 |
| N12 | Skill | done | `.claude/skills/ghbot-production-hardening/SKILL.md` |

## 已修 P0/P1
- 合并 live SHA + `pulls.merge(sha)`
- 冲突 per-PR lock、git timeout、失败 hard reset
- webhook body 30s/413/顶层 catch
- API proxy abort/timeout/20MB cap
- goose 输出 1MB cap、cleanup timeout
- 配置 webhook secret / 半套 R2 fail-fast
- issue_comment AggregateError
- 审批权限查找不再吞掉非 404
- GHBOT_RUNTIME_DIR 契约打通 workflow/env/docs

## 有意未做
- 7.1 processor 路由器拆分（无事件环测试床）
- 6.4 全站 i18n
- goose 安装脚本 checksum（仅改到版本 tag URL）
- origin `lezi-fun/ghbot` 推送（403）

## E2E（2026-08-23，PORT=3011）
```
GET /healthz → 200 {"ok":true,"webhook":true}
POST 合法 HMAC → 202 {"ok":true}
POST 坏签名 → 401
POST 重复 delivery → 202 duplicate
GET /metrics → accepted=1 bad_signature=1 duplicate=1
```
