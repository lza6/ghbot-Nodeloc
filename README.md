# ghbot

[中文文档](README-zh.md)

GitHub Actions bot that uses goose to review pull requests, triage issues and pull requests, flag likely duplicates, answer repository-aware PR questions, and optionally merge approved changes.

## Pull request review

goose returns exactly four sections:

- `review`: concrete non-blocking inline review notes.
- `change`: required inline changes that block merge.
- `comment`: an overall comment for the pull request author.
- `result`: the maintainer-facing merge decision, summary, and malicious-code close decision.

Only `change` is always a required change. How ordinary `review` notes affect merge is configured with `REVIEW_POLICY`:

- `allow`: review notes do not block merge. A clean result is submitted as `APPROVE`.
- `require_approval`: review notes are submitted as `COMMENT`; the `ghbot review` check remains `action_required` until a repository administrator approves the current head commit.
- `reject`: any review note is submitted as `REQUEST_CHANGES` and blocks merge.

The default is `allow`. Required changes and malicious code block under every policy. Clearly malicious pull requests can be commented on and closed automatically. Start with `AUTO_MERGE=false` until the review behavior is trusted.

### Repository-specific rules

Use repository Actions variables to customize a caller repository:

- `REVIEW_INSTRUCTIONS`: additional repository-specific review requirements, such as testing, compatibility, architecture, or release rules.
- `REVIEW_BRANCHES`: comma-separated base-branch globs. Empty reviews all target branches. Example: `main,develop,release/**`.
- `REVIEW_STRICTNESS`: `normal` by default, or `strict` for a thorough repository-policy review. Normal mode avoids nitpicks and reports only clear runtime, build, test, security, data-loss, or important user-facing regressions.
- `MAX_PATCH_CHARS`: maximum total patch text sent for review; default `120000`.
- `GHBOT_RUNTIME_DIR`: optional writable runtime root for `.ghbot-tmp`, `.ghbot-cache`, and repository knowledge files; defaults to the process working directory.

`REVIEW_BRANCHES` matches the pull request's target (base) branch. `*` does not cross `/`; `**` does. The workflow file must be present on the repository's default branch for `pull_request_target`, but that does not limit reviews to PRs targeting the default branch. A workflow installed on `main` can review PRs targeting `develop` or release branches. The bot fetches each PR and its diff by PR number and never executes code from the PR head.

To make `require_approval` or `reject` prevent manual merges, add the `ghbot review` check as a required status check in the target branch's ruleset or branch protection settings. Without that repository rule, ghbot still reports `action_required`, but GitHub may allow an administrator or collaborator to merge manually.

### Incremental review cache in Cloudflare R2

When Cloudflare R2 is configured, each successful review stores this metadata in the private bucket:

- repository and PR number
- reviewed head SHA and timestamp
- the structured `review/change/comment/result` output

When a new commit triggers `synchronize`, or PR metadata/base changes trigger `edited`, the latest cache for that PR is restored. goose receives an earlier-head result plus the current complete PR patch, revalidates old findings, removes fixed findings, and checks the newest content. The previous merge decision is never reused without a fresh review. An `edited` event on the same head still runs a fresh complete review so title, description, and base-branch changes are respected.

For every `synchronize` event, ghbot posts a commit-scoped progress comment when review starts and updates that same comment when the run completes, fails, or becomes stale because the PR changed again. After the new review is published successfully, ghbot marks inline `review` and `change` threads from earlier bot reviews as resolved and minimizes those resolved comments, dismisses any earlier active bot decision, and reduces its old summary to a superseded marker. If GitHub cannot expose a legacy thread through GraphQL, ghbot deletes only that unmappable inline comment as a fallback. GitHub does not allow a submitted review record itself to be deleted, so the newest review is the only full and active automated result.

Objects are isolated by repository ID and PR number. `latest.json` accelerates the next review, while `reviews/<head-sha>.json` preserves each successful head result. Closing or merging a PR does not proactively delete these objects. Cache data contains no API keys, full diff, or prompt.

Configure all of these together:

- Actions secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- Repository variables: `R2_ENDPOINT`, `R2_BUCKET_NAME`
- Optional repository variable: `R2_PREFIX`, a safe object-key namespace such as `forum-114614`

Use a dedicated R2 token limited to read/write objects in this bucket. ghbot validates restored content and repository/PR identity before using it. R2 credentials are available only to the host process and are never forwarded to goose containers, PR validation commands, or git subprocesses. If R2 is absent or temporarily unavailable, review continues without persistent history.

### Self-improving repository knowledge cache

ghbot can retain a concise repository knowledge file in the same private R2 bucket. It is isolated by repository ID and separate from each PR review cache, so it survives PR close and merge events. Automatic review can use durable facts such as architecture, supported environments, trusted validation commands, conventions, and recurring pitfalls.

- `REPOSITORY_KNOWLEDGE_ENABLED`: restore and use repository knowledge; default `true`.
- `REPOSITORY_KNOWLEDGE_WRITE`: allow an authorized `@bot` goose Agent to improve the cached knowledge; default `false`.

The Agent edits only a scratch copy at `.ghbot/repository-knowledge.md`. ghbot validates the result, rejects credentials/private keys and content over 32 KiB, then persists the runtime copy to a repository-scoped R2 object. It is never committed to the caller repository, and the Agent receives neither GitHub nor R2 credentials.

## Issue and PR triage

On `issues` and `pull_request_target` open/edit/reopen events, ghbot can:

- apply one or more labels from the configured allowlist
- compare an issue only with other issues, and a PR only with other PRs
- comment with a possible or likely duplicate and a link to the earlier item
- add the duplicate label only for a high-confidence (`likely`) match

PR duplicate detection runs in two stages: a coarse title/body pass selects at most three plausible candidates, then a detailed pass compares the target and candidates using their recent commits, conversation comments, review summaries, and inline review comments. A duplicate is reported only after the detailed pass. Issue duplicate detection remains single-stage.

The bot does not automatically close duplicates. Duplicate comments contain a hidden marker so repeated triage does not post the same candidate twice. Human labels outside the configured managed label set are preserved.

Triage variables:

- `TRIAGE_ENABLED`: default `true`.
- `TRIAGE_LABELS`: default `bug,enhancement,documentation,question,maintenance`.
- `TRIAGE_DUPLICATE_LABEL`: default `duplicate`.
- `TRIAGE_CANDIDATE_LIMIT`: recent same-type items supplied to goose, default `50`, maximum `100`.
- `TRIAGE_INSTRUCTIONS`: optional repository-specific classification rules.

Missing configured labels are created automatically.

## PR comment chat

Mention `@bot` in a pull request conversation to ask about the current PR. The configured `BOT_NAME` is also accepted as a mention; for example, `BOT_NAME=github-actions[bot]` accepts both `@github-actions` and `@github-actions[bot]`. Because this agent can execute commands, only repository collaborators with `write`, `maintain`, or `admin` permission may invoke it.

When someone without that permission tries `@bot`, `/recheck`, or `/conflict`, ghbot posts a visible reply explaining the required permission and asks them to contact a maintainer. The response is keyed to the source comment so rerunning the workflow does not duplicate it.

This restriction does not affect automatic review. Pull requests from forks and contributors without repository access still receive the normal `review/change/comment/result` review on every configured PR event. When an external contributor needs repository-agent investigation, a maintainer can mention `@bot` on that contributor's PR; the agent then analyzes the contributor's current PR head in isolation and posts the answer to the same conversation.

ghbot checks out the current PR head without persisted GitHub credentials and gives goose a sanitized temporary snapshot plus the PR title, description, branches, and bounded complete diff. goose runs in a dedicated disposable Docker container with the built-in Developer extension enabled in automatic mode. It can execute commands and tests, edit the temporary workspace, install dependencies, and use the network, but the container mounts only the sanitized PR snapshot and receives no GitHub token, GitHub App credentials, or real goose API key. A short-lived local proxy exchanges the container's one-run token for the real provider credential and closes with the container. The agent cannot commit or push, and resource/time limits still apply. The named container is forcibly removed on success, failure, or timeout.

The snapshot excludes Git metadata, repository goose/OpenCode/agent instruction files, `.env`, and symbolic links, then is deleted after the reply. This prevents PR-controlled agent configuration and common credential paths from entering the agent workspace; the container boundary protects the Actions runner and ghbot runtime while preserving full permissions inside the analysis environment.

Replies are keyed to the source comment so a workflow rerun does not post the same answer twice, and bot-authored replies are ignored to prevent loops.

The Agent replies in the language of the latest user comment: English questions receive English answers and Chinese questions receive Chinese answers, regardless of the language used by the PR or repository files.

The prompt also receives host-verified requester context: the commenter's login, whether they authored the PR, their repository permission level, and a derived actor category. This context can tailor the answer but cannot override security rules. Users without `write`, `maintain`, or `admin` permission still do not start the tool-enabled Agent.

When repository knowledge writing is enabled, the Agent may improve its scratch knowledge file only with verified, durable repository facts. Repositories evolve, so it must revise or delete entries that current code, tests, or configuration prove outdated, replaced, contradictory, or no longer true instead of only appending history. Temporary PR conclusions, speculative claims, credentials, personal data, and instructions that weaken security are forbidden. Current repository evidence always takes precedence over cached knowledge.

## Optional GitHub App webhook mode

Action mode remains the default and is complete without a webhook service. `WEBHOOK_ENABLED=false` by default, so existing workflows, review triggers, `/recheck`, `/conflict`, triage, and tool-enabled PR chat continue to use GitHub Actions exactly as before.

Enable webhook mode only when you also run a long-lived Node process or the included `Dockerfile.webhook`. It receives GitHub App webhook events and answers `@bot` mentions in Issue/PR conversation comments, review comments, and submitted reviews. It is useful when the App is installed once for an organization and you want those repositories to share one endpoint. The App must be installed on each repository (or the organization selection must include it); a webhook cannot access repositories where the installation has no access.

Configure the GitHub App webhook URL as `https://your-host/webhooks/github`, and configure `WEBHOOK_SECRET` as a separate long random HMAC secret in both GitHub App webhook settings and the service environment. Never reuse the public URL as the secret. Subscribe to `Issue comments`, `Pull request review comments`, and `Pull request reviews`. The App needs `Metadata: read`, `Issues: read and write`, and `Pull requests: read and write`. The endpoint exchanges each payload's `installation.id` for the correct short-lived installation token, so one fixed installation ID must not be used for all repositories.

Set these service environment variables:

- `WEBHOOK_ENABLED=true` to opt in; the default is `false`.
- `WEBHOOK_SECRET` and optional `WEBHOOK_PATH` (default `/webhooks/github`).
- `BOT_NAME`: the App login or slug accepted in mentions, for example `forumlify[bot]` accepts both `@forumlify` and `@forumlify[bot]`; `@bot` is always accepted.
- `WEBHOOK_CHAT_PERMISSION`: `read` (default), `write`, or `anyone`. On organization-owned repositories, `read` also allows organization members without adding each member as a repository collaborator; personal repositories and non-members continue through the repository collaborator check. `write` allows write, maintain, or admin; `anyone` skips the commenter permission check but still only works in App-installed repositories. The App should have organization-level `Members: read` permission so private organization membership can be verified.
- `WEBHOOK_QUEUE_CONCURRENCY` and `WEBHOOK_QUEUE_LIMIT` bound background work and memory.

Start it with `npm run build && npm run webhook`, or build and run the Docker image:

```bash
docker build -f Dockerfile.webhook -t ghbot-webhook .
docker run --rm -p 3000:3000 \\
  -e WEBHOOK_ENABLED=true \\
  -e WEBHOOK_SECRET='replace-with-a-long-random-secret' \\
  -e GH_APP_ID='123456' \\
  -e GH_APP_PRIVATE_KEY="$GH_APP_PRIVATE_KEY" \\
  -e GOOSE_API_KEY="$GOOSE_API_KEY" \\
  ghbot-webhook
```

Keep TLS termination in a reverse proxy or managed ingress; the Node service listens on `PORT` (default `3000`). `GET /healthz` is available for service probes and `GET /metrics` exposes Prometheus text metrics. GitHub receives `202` before Goose runs because a review-quality model call can exceed GitHub's webhook timeout. Failed background work is retried in-process once; a process crash after `202` is **not** redelivered by GitHub. Use Action mode for durable `/recheck`, `/conflict`, and tool-enabled chat. Webhook chat is best-effort. Deliveries are HMAC-verified and deduplicated by `X-GitHub-Delivery`.

Webhook chat is deliberately read-only: Goose receives repository metadata, README, Issue/PR text, bounded diffs, and recent discussion, but no repository tools or credentials. It cannot edit code, run commands, push commits, run `/recheck`, or run `/conflict`; use Action mode for those operations. Replies follow the language of the latest comment and include no provider or GitHub secrets. Leaving `WEBHOOK_ENABLED` unset preserves the normal Action-only deployment.

## Automatic conflict resolution

Set `AUTO_RESOLVE_CONFLICTS=true` to allow goose to repair a PR that passed review but GitHub reports as `mergeable=false` with `mergeable_state=dirty`. This is independent of `AUTO_MERGE`; conflict repair can be enabled while automatic merging remains disabled.

A collaborator with `write`, `maintain`, or `admin` permission can also explicitly request the same guarded repair by posting the exact command `/conflict`. This manual command works even when `AUTO_RESOLVE_CONFLICTS=false`; it does not require an earlier passing review because the resulting commit always triggers a new complete review before any merge decision.

Automatic conflict repair applies to current same-repository PR heads. External fork commits remain API-only during `pull_request_target`; a maintainer can explicitly run `/conflict` when the contributor enabled **Allow edits from maintainers**. That trusted comment workflow checks out the PR head without persisted credentials and pushes with an explicit `--force-with-lease` tied to the reviewed head SHA, so a newly pushed contributor commit is never overwritten. Stale heads, non-dirty states, disabled maintainer edits, and failed reviews are skipped. ghbot creates the merge locally, gives goose a sanitized credential-free snapshot, and allows it to change direct conflict files plus related callers, types, tests, lockfiles, configuration, or documentation when necessary for compatibility. Protected agent/configuration and credential paths are rejected.

After applying the proposed files, ghbot verifies there are no unmerged paths and runs `git diff --check` only on AI-touched files. When configured, a credential-free validation container mounts the candidate read-only, copies it to a disposable workspace, and runs `CONFLICT_TEST_COMMAND` there. Infrastructure failures are reported directly instead of being sent to goose as code-repair requests; a genuine merge-related validation failure permits one focused edit pass followed by one authoritative host rerun. A separate tool-free goose prompt then performs the final read-only staged-diff confirmation. The result is committed and pushed only when that confirmation returns `safeToCommit=true` and the remote PR head still matches the reviewed SHA. Same-repository heads use a normal push; external forks use the SHA-pinned force lease described above. The new commit triggers a fresh `synchronize` review; the old decision is not reused as approval.

## goose configuration

Required provider secret (one of these aliases must be supplied when a review or Goose operation runs):

- `GOOSE_API_KEY` (preferred)
- `OPENCODE_API_KEY` (migration fallback alias)

Repository variables:

- `GOOSE_BASE_URL`: OpenAI-compatible base URL; default `https://api.openai.com/v1`.
- `GOOSE_MODEL`: default `gpt-5.4`.
- `GOOSE_THINKING_EFFORT`: `off`, `low`, `medium`, `high`, or `max`; default `high` in the workflow.

The workflow installs the pinned goose CLI `v1.46.0`. Review and triage run without extensions in chat mode against the OpenAI-compatible `/v1/chat/completions` API. It invokes:

```text
goose run --no-session --no-profile --quiet --output-format json --provider openai --model <model> --text <prompt>
```

The goose process gets isolated home/config/data/state directories, disables profiles and repository context files, and uses `GOOSE_MODE=chat` for automatic review and triage so no tools can run. Authorized PR comment chat and the two conflict-resolution passes use the Developer extension inside disposable containers.

For migration, the runtime and workflows still accept `OPENCODE_API_KEY`, `OPENCODE_BASE_URL`, `OPENCODE_MODEL`, and `OPENCODE_REASONING_EFFORT` as fallback aliases. New repositories should use the `GOOSE_*` names.

## GitHub authentication and permissions

The workflow always receives `github.token`, so no `GITHUB_TOKEN` repository secret is needed. ghbot optionally prefers a GitHub App installation token and falls back to the workflow token when App authentication fails. The goose provider key remains a separate secret.

Workflow permissions:

- `contents: write`: optional merge and repository operations.
- `pull-requests: write`: list PRs, create reviews, and merge.
- `issues: write`: list issues/PRs, add labels, create labels, and post comments.
- `checks: write`: publish and update the `ghbot review` check.
- `statuses: read`: verify commit statuses before auto-merge.

For a GitHub App, configure these repository permissions:

- Contents: read and write
- Pull requests: read and write
- Issues: read and write
- Checks: read and write
- Commit statuses: read-only
- Metadata: read-only
- Workflows: read and write only if conflict resolution may update workflow files

Add App credentials as optional repository secrets:

- `GH_APP_ID`
- `GH_APP_PRIVATE_KEY`
- `GH_APP_INSTALLATION_ID` (optional; ghbot can resolve it)

GitHub Actions secret names cannot start with `GITHUB_`, so use the `GH_APP_*` names above.

## Reuse from another repository

Create a workflow on the caller repository's default branch. A complete wrapper is available in [.github/workflows/review.yml](.github/workflows/review.yml); the central reusable workflow is:

```text
lezi-fun/ghbot/.github/workflows/review-reusable.yml@main
```

The caller must forward `issues`, `pull_request_target`, `issue_comment`, `pull_request_review`, and optional schedule events, declare the permissions above, and pass:

```yaml
secrets:
  GOOSE_API_KEY: ${{ secrets.GOOSE_API_KEY }}
  GH_APP_ID: ${{ secrets.GH_APP_ID }}
  GH_APP_PRIVATE_KEY: ${{ secrets.GH_APP_PRIVATE_KEY }}
  GH_APP_INSTALLATION_ID: ${{ secrets.GH_APP_INSTALLATION_ID }}
  R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
  R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
```

See the checked-in wrapper for all `with:` inputs and repository-variable mappings.

## Manual recheck

An eligible repository user can comment:

```text
/recheck
```

The bot reruns the complete current PR review using the repository's configured `REVIEW_STRICTNESS`. Only users with `write`, `maintain`, or `admin` permission can request it. The old `/lenient-check` command is no longer accepted.

## Manual conflict repair

An eligible repository user can comment the exact command:

```text
/conflict
```

The bot attempts conflict repair only when GitHub reports the current open PR as conflicted and the head is writable. External forks require **Allow edits from maintainers**; their resolved head is pushed with a force lease pinned to the reviewed SHA. It runs the same configured validation and separate final goose confirmation used by automatic repair, then pushes only if both succeed and the head has not changed.

## Development gates

All changes must pass the local gates before push; CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) enforces the same checks on GitHub:

```bash
npm run typecheck    # TypeScript strict check
npm run lint         # ESLint (flat config)
npm run format:check # Prettier formatting
npm test             # node:test suite (currently 329 passing)
```

The optional webhook service exposes `GET /healthz` and `GET /metrics` (Prometheus text format) for probes and dashboards. The production-hardening change ledger and quiz live at [docs/reports/ghbot-production-hardening.html](docs/reports/ghbot-production-hardening.html).

### v2.0 observability and reliability additions

v2.0 added three supporting modules and hardened the merge/review pipeline:

- **`src/metrics/collector.ts`** — `MetricsCollector` for Actions runs (review duration, outcomes, goose calls, conflict resolutions, merge attempts, cache hits). `snapshot()` and `formatMarkdown()` render a GitHub-flavored summary table.
- **`src/ai/failureMessages.ts`** — `categorizeFailure` (timeout / auth / rate_limit / network / model / validation / unknown) and `formatFailureMessage` produce actionable failure text; wired into the goose error path.
- **`src/review/merge-guard.ts`** — in-process duplicate-merge prevention used around `pulls.merge`.
- **`src/review/staleness.ts`** — `evaluateReviewStaleness` decides whether a head-sha change during a review should be appended or discarded.
- **`src/github/errors.ts`** — shared `isNotFoundError` / `isAlreadyMergedError` helpers, replacing five local duplicates.
- **`src/webhook/queueStore.ts`** — optional durable delivery queue (default off) so webhook tasks survive a process restart.

These were introduced by the changes documented in [docs/audit-v2-final.md](docs/audit-v2-final.md) and [docs/report-v2.html](docs/report-v2.html).

## Local development

```bash
npm install
npm run typecheck
npm run build
```

For local event simulation, install goose `v1.46.0` and export the variables in [.env.example](.env.example), plus `GITHUB_EVENT_NAME` and `GITHUB_EVENT_PATH`, then run:

```bash
node dist/src/actions/runReview.js
```

Normal automatic review and triage use GitHub-provided diffs without executing PR code. When conflict resolution is explicitly enabled, PR code and the configured validation command run only inside sanitized disposable containers without GitHub credentials.
