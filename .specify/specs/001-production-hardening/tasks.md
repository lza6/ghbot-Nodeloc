# Implementation Tasks: 001-production-hardening

## Phase 1: Spec and audit

- [x] 1.1 Constitution + spec
- [x] 1.2 Parallel contract/security/error/docs audit

## Phase 2: Production guards

- [x] 2.1 Merge SHA recheck + pulls.merge sha
- [x] 2.2 Conflict lock + git command timeout + dirty worktree reset
- [x] 2.3 Webhook body timeout/size and request catch
- [x] 2.4 API proxy abort/timeout/body cap
- [x] 2.5 Goose process output cap and cleanup timeouts
- [x] 2.6 Config cross-field validation and GHBOT_RUNTIME_DIR contract
- [x] 2.7 Issue comment handler isolation with AggregateError
- [x] 2.8 Approval permission lookup no longer swallows retryable errors
- [x] 2.9 Event logger child bindings

## Phase 3: Verify and handoff

- [ ] 3.1 Local gates (typecheck/lint/format/test)
- [ ] 3.2 Webhook HTTP E2E
- [ ] 3.3 Independent review
- [ ] 3.4 HTML change report + skill + docs
