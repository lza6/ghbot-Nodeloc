---
name: ghbot-workflow
description: Full workflow guide for ghbot: development cycle, adding endpoints, review checks, audits, and releases.
metadata:
  last_verified: "2026-08-24"
  repo_baseline: "v1.2.0"
---

# ghbot workflow skill

## When to use

This skill covers the operational workflow for the ghbot GitHub review bot project. Use it when asked about development workflow, adding features, running audits, or releasing.

## Do not use

- For unrelated SaaS features
- For changing AUTO_MERGE default value
- For reusing old review cache as a new-head approval
- For running paid LLM E2E without budget
- For pushing to remotes without write permission

---

## 1. Full Workflow: test → typecheck → lint → build → e2e → release

### Local development loop

```bash
# 1. Test (fastest first)
npm test                       # node --import tsx --test test/**/*.test.ts

# 2. Type check
npm run typecheck              # tsc --noEmit

# 3. Lint
npm run lint                   # eslint src test
npm run lint:fix               # auto-fix lint issues

# 4. Format check
npm run format:check           # prettier --check

# 5. Build
npm run build                  # tsc -p tsconfig.json, output to dist/

# 6. Build + test (CI equivalent)
npm run ci:test                # node --import tsx --experimental-test-coverage --test test/**/*.test.ts
```

### CI gate (`.github/workflows/ci.yml`)

The CI workflow runs on every push/PR to main:

1. `npm ci` — clean install
2. `npm run typecheck` — strict type check
3. `npm run lint` — ESLint
4. `npm run format:check` — Prettier style check
5. `node --import tsx --experimental-test-coverage --test test/**/*.test.ts` — full test + coverage

### Pre-commit hooks

The repo uses `scripts/husky-pre-commit.cjs` via `scripts/install-husky.cjs`. Run `node scripts/install-husky.cjs` to set up.

### E2E smoke test

E2E tests require real LLM (goose) and GitHub API access. Run locally only with explicit budget:

```bash
# Requires GOOSE_API_KEY set in .env
# Run the webhook server locally, then send test events
npm run dev:webhook             # tsx src/webhook/server.ts
```

### Release checklist

See section 5 below.

---

## 2. How to Add a New API Endpoint

ghbot has two entry points: GitHub Actions events and the optional webhook HTTP server.

### Adding a new Actions event handler

1. **Define the event type** — Add a new type in `src/actions/router.ts` (e.g., `type NewPayload = { ... }`).

2. **Register a handler** — In `buildDefaultEventRouter()` inside `src/actions/router.ts`, add a new `.register()` call:

```typescript
router.register({
  name: "my-new-event",
  canHandle: (eventName, action) => eventName === "my_event",
  handle: async (ctx) => {
    // Implement your logic
  }
});
```

3. **Wire the payload** — In `src/actions/runReview.ts`, add the new event name to `buildPayloadFromWorkflowCallEnv()`.

4. **Extend the reusable workflow** — In `.github/workflows/review-reusable.yml`, add new inputs if needed.

5. **Add tests** — Create `test/my-new-event.test.ts` with AAA tests.

### Adding a new webhook HTTP endpoint

1. **Add route** — In `src/webhook/server.ts`, `createWebhookServer()`, add a new conditional branch:

```typescript
if (request.method === "POST" && pathname === "/my-endpoint") {
  // validate, parse, handle
  writeJson(response, 200, { ok: true });
  return;
}
```

2. **Add handler** — Extend `WebhookDeliveryHandler` or create a separate handler function.

3. **Add metrics** — Use `MetricsRegistry.inc()` from `src/webhook/metrics.ts`.

4. **Add tests** — Test the HTTP handler in `test/webhook.test.ts`.

### Adding a new `workflow_call` input

1. Add to `configSchema` in `src/config.ts` — use the appropriate Zod validator.
2. Add to `review-reusable.yml` `inputs:` section.
3. Add to `review.yml` `with:` section, wiring from `vars.*` or `secrets.*`.
4. Add to `.env.example` for local development.

---

## 3. How to Add a New Review Check

The review pipeline is: `GooseReviewer.review()` → `normalizeReviewDecision()` → `evaluateReviewDecision()` → `submitReview()`.

### Adding a new finding type in the goose prompt

1. **Extend the prompt** — Edit `src/review/prompt.ts`, `buildSystemPrompt()` function. Add a new rule:

```typescript
// Example: add a new check for hardcoded credentials
const newRule =
  "Check for hardcoded credentials (API keys, passwords, tokens) in the patch. Report as 'change' (blocking) when found in production code.";
```

2. **Update the output schema** — If the new finding needs a new field, update `reviewDecisionSchema` in `src/review/gooseReviewer.ts` and the `ReviewDecision` type in `src/types.ts`.

3. **Update normalization** — If the new field needs validation, update `src/review/normalize.ts`.

### Adding a post-goose processing step

1. **Add a new check function** in `src/review/` — e.g., `src/review/staticChecks.ts`:

```typescript
import type { ReviewFinding } from "../types.js";

export function runStaticChecks(files: unknown[]): ReviewFinding[] {
  // Implement static analysis
  return [];
}
```

2. **Integrate into processor** — In `src/review/processor.ts`, `processPullRequest()`, after the goose review call, merge static findings:

```typescript
const staticFindings = runStaticChecks(compactFiles);
const mergedFindings = [...decision.change, ...staticFindings];
```

3. **Add tests** — Test the static check function in isolation.

### Adding a new review policy option

1. **Add the policy value** — Add to `REVIEW_POLICY` zod enum in `src/config.ts`:

```typescript
reviewPolicy: z.enum(["allow", "require_approval", "reject", "new_policy"]).default("allow"),
```

2. **Handle in policy.ts** — Update `evaluateReviewDecision()` in `src/review/policy.ts` to handle the new value.

3. **Update the review format** — Update `formatReviewBody()` in `src/review/format.ts` to display the new policy.

4. **Update docs** — Add to `.env.example`, `README.md`, and `README-zh.md`.

---

## 4. How to Run the Audit

### Full audit

The comprehensive audit report is at `docs/audit-v2-final.md`. To run a fresh audit:

```bash
# 1. Verify baseline
npm run typecheck && npm test && npm run build

# 2. Generate coverage report
node --import tsx --experimental-test-coverage --test test/**/*.test.ts

# 3. Review compatibility table
# Check docs/audit-v2-final.md for the latest requirements matrix
```

### Quick health check

```bash
# Type + lint + test + build — all four must pass
npm run typecheck && npm run lint && npm test && npm run build
```

### Manual audit checklist

1. **Requirements trace** — Compare `docs/audit-v2-final.md` section 1 against actual code behavior.
2. **Blind spot scan** — Review `docs/audit-v2-final.md` section 2 for known gaps.
3. **Coverage** — Section 7 for current coverage numbers.
4. **Security** — Section 6 for the security review matrix.
5. **Architecture** — Section 4 for module health.

### Continuous audit

Update `workflow_status.md` after each milestone:

- Mark completed items with ✅
- Note remaining items with reasons
- Track coverage, test count, and build passes

---

## 5. How to Do a Release

### Pre-release checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes (0 errors)
- [ ] `npm run format:check` passes
- [ ] `npm test` passes (all tests green)
- [ ] Coverage meets 80% lines target (check `ci:test` output)
- [ ] `npm run build` succeeds
- [ ] `workflow_status.md` is up to date
- [ ] `docs/audit-v2-final.md` is up to date (if applicable)
- [ ] `README.md` and `README-zh.md` reflect current behavior
- [ ] `.env.example` covers all config options

### Release steps

1. **Update version** — Edit `package.json`:

```json
{
  "version": "2.0.0"
}
```

2. **Update changelog** — Create or update `CHANGELOG.md` with conventional commits format:

```markdown
# Changelog

## [2.0.0] - 2026-08-24

### Added

- feat: MergeGuard merge deduplication
- feat: MetricsCollector for Actions runs
- feat: failureMessages error categorization
- feat: smart retry with jitter and total timeout

### Fixed

- fix: normalizeKnowledge line ending normalization
```

3. **Commit and tag**:

```bash
git add -A
git commit -m "chore: bump version to v2.0.0"
git tag v2.0.0
git push origin main --tags
```

4. **Create GitHub Release**:

```bash
gh release create v2.0.0 --title "v2.0.0" --notes "Release notes here"
```

5. **Verify release**:

- Check that `review.yml` workflow dispatches correctly
- Verify the reusable workflow at the new tag works
- Confirm CI passes on the release commit

### Post-release

- Update `workflow_status.md` with the new baseline
- Archive the audit report to `docs/reports/` if detailed
- Update `metadata.repo_baseline` in this skill file

---

## Configuration Reference

All config is defined in `src/config.ts` with Zod schema validation. Key environment variables:

| Variable                 | Default   | Description                                  |
| ------------------------ | --------- | -------------------------------------------- |
| `GOOSE_API_KEY`          | —         | LLM API key for goose                        |
| `GOOSE_MODEL`            | `gpt-5.4` | Model name                                   |
| `REVIEW_POLICY`          | `allow`   | Review policy: allow/require_approval/reject |
| `REVIEW_STRICTNESS`      | `normal`  | Review strictness: normal/strict             |
| `AUTO_MERGE`             | `false`   | Auto-merge on pass                           |
| `AUTO_RESOLVE_CONFLICTS` | `false`   | Auto-resolve merge conflicts                 |
| `TRIAGE_ENABLED`         | `true`    | Enable issue/PR triage                       |
| `WEBHOOK_ENABLED`        | `false`   | Enable webhook mode                          |

Full list in `.env.example` and `src/config.ts`.

---

## Key Files

| Path                             | Purpose                                 |
| -------------------------------- | --------------------------------------- |
| `src/actions/router.ts`          | Event routing and handler registration  |
| `src/actions/runReview.ts`       | Actions entry point                     |
| `src/review/processor.ts`        | Core review orchestration               |
| `src/review/policy.ts`           | Review policy evaluation                |
| `src/review/gooseReviewer.ts`    | LLM review prompt + schema              |
| `src/review/conflictResolver.ts` | Merge conflict resolution               |
| `src/triage/processor.ts`        | Issue/PR triage and duplicate detection |
| `src/chat/processor.ts`          | @bot chat in disposable containers      |
| `src/ai/gooseCli.ts`             | Goose CLI and Docker wrappers           |
| `src/ai/apiProxy.ts`             | One-time credential proxy               |
| `src/config.ts`                  | All env config with Zod validation      |
| `src/metrics/collector.ts`       | Actions metrics collector               |
| `src/review/merge-guard.ts`      | Merge deduplication guard               |
| `src/ai/failureMessages.ts`      | Error categorization                    |
| `docs/audit-v2-final.md`         | Comprehensive audit report              |
| `workflow_status.md`             | Milestone tracking                      |
| `.github/workflows/ci.yml`       | CI pipeline                             |
| `.github/workflows/review.yml`   | PR review workflow                      |
