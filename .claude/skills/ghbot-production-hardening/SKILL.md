---
name: ghbot-production-hardening
description: Production close-out workflow for ghbot: spec, audit, fix P0/P1 guards, gates, webhook HTTP smoke, independent review, docs.
metadata:
  last_verified: "2026-08-23"
  repo_baseline: "v1.1.0-hardening"
---

# ghbot production hardening skill

## When to use

Closing a production iteration of this GitHub review bot. Not for adding unrelated SaaS features.

## Do not use

- Changing AUTO_MERGE default
- Reusing old review cache as a new-head approval
- Running paid LLM E2E without budget
- Pushing to remotes without write permission

## Inputs

Current repo, CLAUDE.md red lines, `.specify/memory/constitution.md`.

## Steps

1. Read constitution, CLAUDE.md, workflow_status.md, last verification record.
2. Rebuild facts: git status, typecheck, test.
3. Audit contract/security/error/docs before coding.
4. Fix P0 then P1 with tests. Skip 1700-line processor extraction unless an event-loop harness exists.
5. Gates: typecheck, lint, format:check, test, build, npm audit --omit=dev.
6. Webhook HTTP smoke on a spare port: /healthz, HMAC 202, bad sig 401, duplicate, /metrics.
7. Independent critic. Repair only confirmed Blocking/Required.
8. Sync README/.env.example/workflows. Write HTML report under docs/reports/.

## Stop

Missing credentials, origin 403, paid API, production deploy, no progress after two review loops.

## Verify

Never claim LLM review E2E or origin push without command evidence.
