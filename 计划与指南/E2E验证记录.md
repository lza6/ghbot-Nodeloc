# E2E 验证记录 — webhook 服务真实运行

**执行时间**：2026-08-22
**方式**：`npm run build` 后用 `node dist/src/webhook/server.js` 以生产构建真实启动服务，
通过 curl 实际发送 HTTP 请求验证。

## 验证矩阵

| # | 场景 | 请求 | 期望 | 实际结果 | 状态 |
|---|------|------|------|----------|------|
| 1 | 服务启动 | `node dist/src/webhook/server.js`（`WEBHOOK_ENABLED=true`） | 监听 3000 | 日志输出 `GitHub webhook server is listening` | ✅ |
| 2 | 健康检查 | `GET /healthz` | 200 `{"ok":true,"webhook":true}` | 一致 | ✅ |
| 3 | 指标端点 | `GET /metrics` | Prometheus 文本 + uptime | `ghbot_uptime_seconds 3` | ✅ |
| 4 | 合法签名投递 | `POST /webhooks/github`（正确 HMAC） | 202 `{"ok":true}` | 一致 | ✅ |
| 5 | 非法签名拒绝 | 同上但签名错误 | 401 `{"error":"Invalid webhook signature."}` | 一致 | ✅ |
| 6 | delivery 去重 | 相同 `x-github-delivery` 重放 | 202 `{"ok":true,"duplicate":true}` | 一致 | ✅ |
| 7 | 指标计数 | `GET /metrics` | accepted=1, bad_signature=1, duplicate=1 | 三项计数全部正确 | ✅ |

## 指标输出实测

```text
ghbot_webhook_deliveries_total{event="issue_comment",result="accepted"} 1
ghbot_webhook_requests_total{result="bad_signature"} 1
ghbot_webhook_deliveries_total{result="duplicate"} 1
```

## 结论

webhook 服务从启动 → 鉴权 → 去重 → 可观测性的完整链路在真实 HTTP 层验证通过。

## 回归（2026-08-23，PORT=3011，生产 dist）

同一矩阵在硬化改动后复测：healthz 200、合法 HMAC 202、坏签名 401、重复 delivery duplicate、metrics 三项计数正确。

