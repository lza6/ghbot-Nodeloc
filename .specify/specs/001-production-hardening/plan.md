# Implementation Plan: 001-production-hardening

## Current architecture

ghbot is a GitHub Actions + optional webhook Node service. Review, triage, conflict repair, and @bot chat are orchestrated from `src/actions/runReview.ts`. Config is a single zod schema in `src/config.ts`. Persistence is optional R2 plus local scratch directories.

## Impacted modules

- `src/review/processor.ts` — merge SHA pinning, stale-head discard, approval lookup errors
- `src/review/conflictResolver.ts` — per-PR lock, git timeouts, worktree reset
- `src/ai/apiProxy.ts` / `src/ai/gooseCli.ts` — proxy/process timeouts and bounded output
- `src/webhook/server.ts` — body deadline, request catch, metrics
- `src/config.ts` / workflows / `.env.example` — GHBOT_RUNTIME_DIR, webhook/R2 cross-checks
- docs — webhook secret, docker run, goose aliases

## Implementation strategy

Fix production failure modes first. Keep AUTO_MERGE default false. Prefer additive guards over architecture rewrites. Do not extract the 1700-line processor router in this pass because there is no isolated event-loop test harness; that refactor is deferred with an explicit risk note.

## Verification

- npm run typecheck / lint / format:check / test
- production-build webhook HTTP smoke (healthz, HMAC, duplicate, metrics)
- npm audit --omit=dev against registry.npmjs.org
- independent six-dimension review after gates

## Rollback

Revert the production-hardening commit on the fork. Defaults remain conservative (AUTO_MERGE=false, WEBHOOK_ENABLED=false).
