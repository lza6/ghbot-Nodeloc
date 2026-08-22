import type { Octokit } from "@octokit/rest";
import { config } from "../config.js";
import { requiredChecksAreGreen } from "../github/checks.js";
import { postPermissionDeniedComment } from "../github/commandFeedback.js";
import { formatBotDisplayName } from "../github/botIdentity.js";
import { collectValidNewLines, toDiffPosition } from "../github/diff.js";
import { logger } from "../logger.js";
import { withRetry } from "../retry.js";
import type { PullRequestFile, PullRequestRef, ReviewDecision, ReviewMode } from "../types.js";
import { deleteLocalReviewCache, loadPreviousReview, saveReviewCache } from "./cache.js";
import { GooseReviewer } from "./gooseReviewer.js";
import { formatFindingReviewBody, formatReviewBody, type CategorizedFinding } from "./format.js";
import {
  approvedLoginsForHead,
  evaluateReviewDecision,
  formatReviewExternalId,
  isReviewBranchEnabled,
  parseReviewExternalId,
  parseReviewStateMarker
} from "./policy.js";
import { compactFilesForReview } from "./prompt.js";
import { loadRepositoryKnowledge } from "../repository/knowledge.js";
import {
  canAutoResolveConflicts,
  describeConflictResolutionFailure,
  resolvePullRequestConflicts
} from "./conflictResolver.js";

const reviewer = new GooseReviewer();
const CHECK_RUN_NAME = "ghbot review";
export const RECHECK_COMMENT_COMMAND = "/recheck";
export const CONFLICT_COMMENT_COMMAND = "/conflict";
const REVIEW_PROGRESS_MARKER_PREFIX = "<!-- ghbot-review-progress:v1";

function conflictAutomationName(): string {
  return formatBotDisplayName(config.botName);
}

export async function processPullRequest(
  octokit: Octokit,
  ref: PullRequestRef,
  mode: ReviewMode = "normal",
  gitToken?: string
): Promise<void> {
  const { owner, repo, pullNumber } = ref;

  const { data: pullRequest } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  });

  if (pullRequest.draft) {
    logger.info({ owner, repo, pullNumber }, "Skipping draft pull request.");
    return;
  }

  if (pullRequest.state !== "open") {
    logger.info(
      { owner, repo, pullNumber, state: pullRequest.state },
      "Skipping non-open pull request."
    );
    return;
  }

  if (!isReviewBranchEnabled(pullRequest.base.ref)) {
    logger.info(
      {
        owner,
        repo,
        pullNumber,
        baseBranch: pullRequest.base.ref,
        reviewBranches: config.reviewBranches
      },
      "Skipping pull request because its base branch does not match REVIEW_BRANCHES."
    );
    return;
  }

  const files = await listPullRequestFiles(octokit, owner, repo, pullNumber);
  const compactFiles = compactFilesForReview(files, config.maxPatchChars);
  const previousReview = await loadPreviousReview({
    owner,
    repo,
    pullNumber,
    currentHeadSha: pullRequest.head.sha
  });
  const repositoryKnowledge = config.repositoryKnowledgeEnabled
    ? await loadRepositoryKnowledge().catch((error: unknown) => {
        logger.warn(
          { error, owner, repo, pullNumber },
          "Ignoring unavailable repository knowledge."
        );
        return undefined;
      })
    : undefined;
  const decision = await reviewer.review({
    title: pullRequest.title,
    body: pullRequest.body,
    files: compactFiles,
    mode,
    previousReview,
    repositoryKnowledge
  });

  const { data: currentPullRequest } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  });
  if (currentPullRequest.state !== "open" || currentPullRequest.head.sha !== pullRequest.head.sha) {
    await deleteLocalReviewCache(pullNumber);
    logger.info(
      {
        owner,
        repo,
        pullNumber,
        reviewedHead: pullRequest.head.sha,
        currentHead: currentPullRequest.head.sha,
        currentState: currentPullRequest.state
      },
      "Discarding stale review because the pull request changed while goose was running."
    );
    return;
  }

  await saveReviewCache({ owner, repo, pullNumber, headSha: pullRequest.head.sha, decision });

  await submitReview(octokit, {
    owner,
    repo,
    pullNumber,
    commitId: pullRequest.head.sha,
    files,
    decision,
    mode
  });

  await upsertReviewCheckRun(octokit, {
    owner,
    repo,
    headSha: pullRequest.head.sha,
    pullNumber,
    decision,
    mode
  });

  if (decision.result.shouldClosePullRequest) {
    await closeMaliciousPullRequest(octokit, {
      owner,
      repo,
      pullNumber,
      reason: decision.result.closeReason || "The automated review found clearly malicious code."
    });
    logger.warn(
      { owner, repo, pullNumber },
      "Closed pull request because malicious code was detected."
    );
    return;
  }

  const disposition = evaluateReviewDecision(decision);
  if (disposition.requiresAdminApproval) {
    const alreadyApprovedByAdmin = await hasCurrentHeadApprovalFrom(octokit, {
      owner,
      repo,
      pullNumber,
      headSha: pullRequest.head.sha,
      requireAdmin: true
    });

    if (alreadyApprovedByAdmin) {
      await markReviewCheckApproved(octokit, {
        owner,
        repo,
        headSha: pullRequest.head.sha,
        pullNumber
      });
    }
  }

  if (disposition.blocksMerge) {
    logger.info({ owner, repo, pullNumber }, "Review requested changes; not merging.");
    return;
  }

  const mergeablePullRequest = await waitForMergeable(octokit, owner, repo, pullNumber);
  const conflictResolutionEligible = canAutoResolveConflicts({
    enabled: config.autoResolveConflicts,
    reviewPassed: true,
    mergeable: mergeablePullRequest.mergeable,
    mergeableState: mergeablePullRequest.mergeable_state,
    baseRepository: `${owner}/${repo}`,
    headRepository: pullRequest.head.repo?.full_name ?? null,
    maintainerCanModify: pullRequest.maintainer_can_modify ?? false,
    expectedHeadSha: pullRequest.head.sha,
    currentHeadSha: currentPullRequest.head.sha
  });
  if (conflictResolutionEligible) {
    const worktree = process.env.GHBOT_PR_WORKTREE;
    if (!gitToken || !worktree) {
      logger.warn(
        { owner, repo, pullNumber, hasGitToken: Boolean(gitToken), hasWorktree: Boolean(worktree) },
        "Cannot resolve pull request conflicts without a git token and PR worktree."
      );
    } else {
      try {
        const resolved = await resolvePullRequestConflicts(octokit, {
          owner,
          repo,
          pullNumber,
          expectedHeadSha: pullRequest.head.sha,
          baseBranch: pullRequest.base.ref,
          headBranch: pullRequest.head.ref,
          headRepository: pullRequest.head.repo?.full_name ?? null,
          maintainerCanModify: pullRequest.maintainer_can_modify ?? false,
          worktree,
          gitToken,
          repositoryKnowledge
        });
        if (resolved) {
          await withRetry("github.issues.createComment.conflictsResolved", async () => {
            return octokit.rest.issues.createComment({
              owner,
              repo,
              issue_number: pullNumber,
              body: `${conflictAutomationName()} resolved the merge conflicts, validated the final changes, and pushed a new commit. The new head will be reviewed again before any merge decision.`
            });
          });
          return;
        }
      } catch (error) {
        logger.error(
          { err: error, owner, repo, pullNumber },
          "Automatic conflict resolution failed safely."
        );
        await withRetry("github.issues.createComment.conflictResolutionFailed", async () => {
          return octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: pullNumber,
            body: `Automated review passed, but ${describeConflictResolutionFailure(error, conflictAutomationName())}`
          });
        });
        return;
      }
    }
  }

  await maybeMergePullRequest(octokit, {
    owner,
    repo,
    pullNumber,
    title: pullRequest.title,
    headSha: pullRequest.head.sha,
    mode,
    requireAdminApproval: disposition.requiresAdminApproval,
    emitStatusComments: true,
    mergeablePullRequest
  });
}

export async function processScheduledPendingMerges(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
  }
): Promise<void> {
  if (!config.autoMerge) {
    logger.info(
      { owner: params.owner, repo: params.repo },
      "Skipping scheduled pending merge check because AUTO_MERGE is disabled."
    );
    return;
  }

  const pullRequests = await octokit.paginate(octokit.rest.pulls.list, {
    owner: params.owner,
    repo: params.repo,
    state: "open",
    per_page: 100
  });

  for (const pullRequest of pullRequests) {
    if (pullRequest.draft || !isReviewBranchEnabled(pullRequest.base.ref)) {
      continue;
    }

    const latestReviewOutcome = await getLatestBotReviewOutcomeForHead(octokit, {
      owner: params.owner,
      repo: params.repo,
      pullNumber: pullRequest.number,
      headSha: pullRequest.head.sha
    });

    if (!latestReviewOutcome || latestReviewOutcome.outcome !== "pass") {
      continue;
    }

    if (!latestReviewOutcome.requiresAdminApproval) {
      continue;
    }

    const approvedByEligibleReviewer = await hasCurrentHeadApprovalFrom(octokit, {
      owner: params.owner,
      repo: params.repo,
      pullNumber: pullRequest.number,
      headSha: pullRequest.head.sha,
      requireAdmin: true
    });

    if (!approvedByEligibleReviewer) {
      continue;
    }

    if (latestReviewOutcome.requiresAdminApproval) {
      await markReviewCheckApproved(octokit, {
        owner: params.owner,
        repo: params.repo,
        headSha: pullRequest.head.sha,
        pullNumber: pullRequest.number
      });
    }

    await maybeMergePullRequest(octokit, {
      owner: params.owner,
      repo: params.repo,
      pullNumber: pullRequest.number,
      title: pullRequest.title,
      headSha: pullRequest.head.sha,
      mode: latestReviewOutcome.mode,
      requireAdminApproval: latestReviewOutcome.requiresAdminApproval,
      emitStatusComments: false
    });
  }
}

export async function shouldReviewPullRequest(
  octokit: Octokit,
  params: { owner: string; repo: string; pullNumber: number }
): Promise<boolean> {
  const { data: pullRequest } = await octokit.rest.pulls.get({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber
  });
  return isReviewBranchEnabled(pullRequest.base.ref);
}

export async function beginCommitReviewProgress(
  octokit: Octokit,
  params: { owner: string; repo: string; pullNumber: number }
): Promise<{ commentId: number; headSha: string } | undefined> {
  const { data: pullRequest } = await octokit.rest.pulls.get({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber
  });
  if (pullRequest.state !== "open" || pullRequest.draft) {
    return undefined;
  }

  const marker = reviewProgressMarker(pullRequest.head.sha);
  const body = [
    marker,
    `New commit \`${shortSha(pullRequest.head.sha)}\` detected. Automated review has started for this commit.`
  ].join("\n");
  const existing = await findIssueCommentByMarker(octokit, params, marker);
  const response = existing
    ? await withRetry("github.issues.updateComment.reviewProgressStarted", async () => {
        return octokit.rest.issues.updateComment({
          owner: params.owner,
          repo: params.repo,
          comment_id: existing.id,
          body
        });
      })
    : await withRetry("github.issues.createComment.reviewProgressStarted", async () => {
        return octokit.rest.issues.createComment({
          owner: params.owner,
          repo: params.repo,
          issue_number: params.pullNumber,
          body
        });
      });

  return { commentId: response.data.id, headSha: pullRequest.head.sha };
}

export async function finishCommitReviewProgress(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    commentId: number;
    headSha: string;
    failed?: boolean;
  }
): Promise<void> {
  const marker = reviewProgressMarker(params.headSha);
  let message: string;
  if (params.failed) {
    message = `Automated review could not complete for commit \`${shortSha(params.headSha)}\`. A maintainer can inspect the failed Actions run or comment \`/recheck\` after the problem is corrected.`;
  } else {
    const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
      owner: params.owner,
      repo: params.repo,
      pull_number: params.pullNumber,
      per_page: 100
    });
    const published = reviews.some(
      (review) =>
        review.commit_id === params.headSha && Boolean(parseReviewStateMarker(review.body))
    );
    message = published
      ? `Automated review completed for commit \`${shortSha(params.headSha)}\`. The latest review result and \`${CHECK_RUN_NAME}\` check now reflect this commit.`
      : `The review run ended without publishing a result for commit \`${shortSha(params.headSha)}\`, usually because the PR changed again while it was running. The newest commit will be reviewed separately.`;
  }

  await withRetry("github.issues.updateComment.reviewProgressFinished", async () => {
    return octokit.rest.issues.updateComment({
      owner: params.owner,
      repo: params.repo,
      comment_id: params.commentId,
      body: [marker, message].join("\n")
    });
  });
}

export async function processPullRequestReviewApproval(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    reviewerLogin: string;
    state: string;
    commitId: string;
  }
): Promise<void> {
  if (params.state !== "approved") {
    return;
  }

  const { data: pullRequest } = await octokit.rest.pulls.get({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber
  });

  if (pullRequest.head.sha !== params.commitId) {
    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        pullNumber: params.pullNumber,
        approvedCommit: params.commitId,
        currentHead: pullRequest.head.sha
      },
      "Ignoring approval because it does not match the current PR head."
    );
    return;
  }

  if (!isReviewBranchEnabled(pullRequest.base.ref)) {
    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        pullNumber: params.pullNumber,
        baseBranch: pullRequest.base.ref
      },
      "Ignoring approval for a pull request outside REVIEW_BRANCHES."
    );
    return;
  }

  const latestReviewOutcome = await getLatestBotReviewOutcomeForHead(octokit, {
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
    headSha: params.commitId
  });

  if (!latestReviewOutcome || latestReviewOutcome.outcome !== "pass") {
    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        pullNumber: params.pullNumber,
        commitId: params.commitId
      },
      "Ignoring approval because there is no successful bot review for the current head."
    );
    return;
  }

  const { data: permission } = await octokit.rest.repos
    .getCollaboratorPermissionLevel({
      owner: params.owner,
      repo: params.repo,
      username: params.reviewerLogin
    })
    .catch((error: unknown) => {
      if (isNotFoundError(error)) {
        return { data: { permission: null } };
      }

      throw error;
    });

  const requireAdmin = latestReviewOutcome.requiresAdminApproval;
  const allowedPermissions = requireAdmin
    ? new Set(["admin"])
    : new Set(["admin", "maintain", "write"]);

  if (!permission.permission || !allowedPermissions.has(permission.permission)) {
    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        pullNumber: params.pullNumber,
        reviewerLogin: params.reviewerLogin,
        permission: permission.permission,
        requireAdmin
      },
      "Ignoring approval because reviewer does not meet the current permission threshold."
    );
    return;
  }

  if (latestReviewOutcome.requiresAdminApproval) {
    await markReviewCheckApproved(octokit, {
      owner: params.owner,
      repo: params.repo,
      headSha: pullRequest.head.sha,
      pullNumber: params.pullNumber
    });
  }

  await maybeMergePullRequest(octokit, {
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
    title: pullRequest.title,
    headSha: pullRequest.head.sha,
    mode: latestReviewOutcome.mode,
    requireAdminApproval: latestReviewOutcome.requiresAdminApproval,
    emitStatusComments: true
  });
}

export async function processRecheckComment(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    commentId: number;
    commenterLogin: string;
    commentBody: string;
    gitToken?: string;
  }
): Promise<void> {
  if (!isRecheckComment(params.commentBody)) {
    return;
  }

  const { data: pullRequest } = await octokit.rest.pulls.get({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber
  });
  if (!isReviewBranchEnabled(pullRequest.base.ref)) {
    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        pullNumber: params.pullNumber,
        baseBranch: pullRequest.base.ref
      },
      "Ignoring recheck outside REVIEW_BRANCHES."
    );
    return;
  }

  const { data: permission } = await octokit.rest.repos
    .getCollaboratorPermissionLevel({
      owner: params.owner,
      repo: params.repo,
      username: params.commenterLogin
    })
    .catch((error: unknown) => {
      if (isNotFoundError(error)) {
        return { data: { permission: null } };
      }

      throw error;
    });

  const allowedPermissions = new Set(["admin", "maintain", "write"]);

  if (!permission.permission || !allowedPermissions.has(permission.permission)) {
    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        pullNumber: params.pullNumber,
        commenterLogin: params.commenterLogin,
        permission: permission.permission
      },
      "Ignoring recheck comment because commenter does not have write permission."
    );
    await postPermissionDeniedComment(octokit, {
      owner: params.owner,
      repo: params.repo,
      pullNumber: params.pullNumber,
      sourceCommentId: params.commentId,
      commenterLogin: params.commenterLogin,
      command: "/recheck"
    });
    return;
  }

  logger.info(
    {
      owner: params.owner,
      repo: params.repo,
      pullNumber: params.pullNumber,
      commenterLogin: params.commenterLogin,
      permission: permission.permission
    },
    "Processing recheck comment command."
  );

  await withRetry("github.issues.createComment.recheckRequested", async () => {
    return octokit.rest.issues.createComment({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.pullNumber,
      body: `Recheck requested by @${params.commenterLogin}. Re-running the review with the repository's current strictness settings.`
    });
  });

  await processPullRequest(
    octokit,
    {
      owner: params.owner,
      repo: params.repo,
      pullNumber: params.pullNumber
    },
    config.reviewStrictness === "strict" ? "strict" : "normal",
    params.gitToken
  );
}

export async function processConflictComment(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    commentId: number;
    commenterLogin: string;
    commentBody: string;
    gitToken?: string;
  }
): Promise<void> {
  if (!isConflictComment(params.commentBody)) {
    return;
  }

  const { data: permission } = await octokit.rest.repos
    .getCollaboratorPermissionLevel({
      owner: params.owner,
      repo: params.repo,
      username: params.commenterLogin
    })
    .catch((error: unknown) => {
      if (isNotFoundError(error)) {
        return { data: { permission: null } };
      }
      throw error;
    });
  if (
    !permission.permission ||
    !new Set(["admin", "maintain", "write"]).has(permission.permission)
  ) {
    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        pullNumber: params.pullNumber,
        commentId: params.commentId,
        commenterLogin: params.commenterLogin,
        permission: permission.permission
      },
      "Ignoring conflict command because commenter does not have write permission."
    );
    await postPermissionDeniedComment(octokit, {
      owner: params.owner,
      repo: params.repo,
      pullNumber: params.pullNumber,
      sourceCommentId: params.commentId,
      commenterLogin: params.commenterLogin,
      command: "/conflict"
    });
    return;
  }

  const { data: pullRequest } = await octokit.rest.pulls.get({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber
  });
  if (
    pullRequest.state !== "open" ||
    pullRequest.draft ||
    !isReviewBranchEnabled(pullRequest.base.ref)
  ) {
    await postConflictCommandComment(
      octokit,
      params,
      "This PR is not an open, non-draft pull request on a configured review branch, so no conflict-resolution commit was created."
    );
    return;
  }

  const mergeablePullRequest = await waitForMergeable(
    octokit,
    params.owner,
    params.repo,
    params.pullNumber
  );
  const eligible = canAutoResolveConflicts({
    enabled: true,
    reviewPassed: true,
    mergeable: mergeablePullRequest.mergeable,
    mergeableState: mergeablePullRequest.mergeable_state,
    baseRepository: `${params.owner}/${params.repo}`,
    headRepository: pullRequest.head.repo?.full_name ?? null,
    maintainerCanModify: pullRequest.maintainer_can_modify ?? false,
    expectedHeadSha: pullRequest.head.sha,
    currentHeadSha: mergeablePullRequest.head.sha
  });
  if (!eligible) {
    const reason =
      pullRequest.head.repo?.full_name !== `${params.owner}/${params.repo}` &&
      !pullRequest.maintainer_can_modify
        ? "The PR comes from an external fork whose contributor has disabled maintainer edits. Enable ‘Allow edits from maintainers’, then run /conflict again."
        : mergeablePullRequest.mergeable_state !== "dirty"
          ? `GitHub does not currently report a merge conflict (mergeable=${mergeablePullRequest.mergeable}, mergeable_state=${mergeablePullRequest.mergeable_state}).`
          : "The PR head changed while conflict eligibility was being checked. Run /conflict again on the latest head.";
    await postConflictCommandComment(octokit, params, reason);
    return;
  }

  const worktree = process.env.GHBOT_PR_WORKTREE;
  if (!params.gitToken || !worktree) {
    throw new Error("The /conflict command requires a git token and checked-out PR worktree.");
  }

  await postConflictCommandComment(
    octokit,
    params,
    `Conflict resolution requested by @${params.commenterLogin}. ${conflictAutomationName()} is resolving the current head and will push only after the configured validation and a separate final confirmation pass succeed.`
  );
  try {
    const repositoryKnowledge = config.repositoryKnowledgeEnabled
      ? await loadRepositoryKnowledge().catch(() => undefined)
      : undefined;
    const resolved = await resolvePullRequestConflicts(octokit, {
      owner: params.owner,
      repo: params.repo,
      pullNumber: params.pullNumber,
      expectedHeadSha: pullRequest.head.sha,
      baseBranch: pullRequest.base.ref,
      headBranch: pullRequest.head.ref,
      headRepository: pullRequest.head.repo?.full_name ?? null,
      maintainerCanModify: pullRequest.maintainer_can_modify ?? false,
      worktree,
      gitToken: params.gitToken,
      repositoryKnowledge
    });
    await postConflictCommandComment(
      octokit,
      params,
      resolved
        ? `${conflictAutomationName()} resolved the conflicts, validated the complete result, and pushed a new commit. The new head will now receive a fresh review.`
        : "The PR changed or no resolvable conflict remained before push, so no commit was created."
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        owner: params.owner,
        repo: params.repo,
        pullNumber: params.pullNumber,
        commentId: params.commentId,
        commenterLogin: params.commenterLogin
      },
      "Manual conflict resolution failed safely."
    );
    await postConflictCommandComment(
      octokit,
      params,
      describeConflictResolutionFailure(error, conflictAutomationName())
    );
    throw error;
  }
}

async function postConflictCommandComment(
  octokit: Octokit,
  params: { owner: string; repo: string; pullNumber: number },
  body: string
): Promise<void> {
  await withRetry("github.issues.createComment.conflictCommand", async () => {
    return octokit.rest.issues.createComment({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.pullNumber,
      body
    });
  });
}

async function maybeMergePullRequest(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    title: string;
    headSha: string;
    mode: ReviewMode;
    requireAdminApproval: boolean;
    emitStatusComments: boolean;
    mergeablePullRequest?: Awaited<ReturnType<typeof waitForMergeable>>;
  }
): Promise<void> {
  const { owner, repo, pullNumber } = params;

  if (!config.autoMerge) {
    logger.info({ owner, repo, pullNumber }, "AUTO_MERGE is disabled; approved only.");
    return;
  }

  if (params.requireAdminApproval) {
    const approvedByEligibleReviewer = await hasCurrentHeadApprovalFrom(octokit, {
      owner,
      repo,
      pullNumber,
      headSha: params.headSha,
      requireAdmin: true
    });

    if (!approvedByEligibleReviewer) {
      if (params.emitStatusComments) {
        await withRetry("github.issues.createComment.awaitAdminApproval", async () => {
          return octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: pullNumber,
            body: `Automated review passed, but this PR will not be merged until a repository administrator approves the current head commit.\n\nNext step: in the GitHub pull request UI, click "Review changes" and submit an "Approve" review. No extra command is needed.`
          });
        });
      }
      logger.info(
        { owner, repo, pullNumber },
        "Waiting for administrator approval before merging."
      );
      return;
    }
  }

  const mergeablePullRequest =
    params.mergeablePullRequest ?? (await waitForMergeable(octokit, owner, repo, pullNumber));
  if (mergeablePullRequest.mergeable !== true || mergeablePullRequest.mergeable_state === "dirty") {
    if (params.emitStatusComments) {
      await withRetry("github.issues.createComment.notMergeable", async () => {
        return octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: pullNumber,
          body: `Automated review approved this PR, but it was not merged because GitHub reports mergeable=${mergeablePullRequest.mergeable} and mergeable_state=${mergeablePullRequest.mergeable_state}.`
        });
      });
    }
    return;
  }

  if (config.requireChecks) {
    const checks = await requiredChecksAreGreen(octokit, {
      owner,
      repo,
      ref: params.headSha
    });
    if (!checks.ok) {
      if (params.emitStatusComments) {
        await withRetry("github.issues.createComment.requiredChecks", async () => {
          return octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: pullNumber,
            body: `Automated review approved this PR, but it was not merged because required checks are not green. ${checks.reason ?? ""}`.trim()
          });
        });
      }
      return;
    }
  }

  await withRetry("github.pulls.merge", async () => {
    return octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: pullNumber,
      merge_method: config.mergeMethod,
      commit_title: `${params.title} (#${pullNumber})`
    });
  });
}

async function hasCurrentHeadApprovalFrom(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    headSha: string;
    requireAdmin: boolean;
  }
): Promise<boolean> {
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber,
    per_page: 100
  });

  const approvedLogins = approvedLoginsForHead(
    reviews.map((review) => ({
      id: review.id,
      state: review.state,
      commitId: review.commit_id,
      login: review.user?.login,
      submittedAt: review.submitted_at
    })),
    params.headSha
  );

  for (const login of approvedLogins) {
    try {
      const { data: permission } = await octokit.rest.repos
        .getCollaboratorPermissionLevel({
          owner: params.owner,
          repo: params.repo,
          username: login
        })
        .catch((error: unknown) => {
          if (isNotFoundError(error)) {
            return { data: { permission: null } };
          }

          throw error;
        });

      if (!permission.permission) {
        continue;
      }

      if (params.requireAdmin) {
        if (permission.permission === "admin") {
          return true;
        }
        continue;
      }

      if (new Set(["admin", "maintain", "write"]).has(permission.permission)) {
        return true;
      }
    } catch (error) {
      logger.warn(
        {
          error,
          owner: params.owner,
          repo: params.repo,
          pullNumber: params.pullNumber,
          login
        },
        "Failed to resolve collaborator permission while checking approval eligibility."
      );
    }
  }

  return false;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

function reviewProgressMarker(headSha: string): string {
  return `${REVIEW_PROGRESS_MARKER_PREFIX} head=${headSha} -->`;
}

function shortSha(headSha: string): string {
  return headSha.slice(0, 12);
}

async function findIssueCommentByMarker(
  octokit: Octokit,
  params: { owner: string; repo: string; pullNumber: number },
  marker: string
) {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: params.owner,
    repo: params.repo,
    issue_number: params.pullNumber,
    per_page: 100
  });
  return comments.find((comment) => comment.body?.includes(marker));
}

async function getLatestBotReviewOutcomeForHead(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    headSha: string;
  }
) {
  const checks = await octokit.rest.checks.listForRef({
    owner: params.owner,
    repo: params.repo,
    ref: params.headSha,
    check_name: CHECK_RUN_NAME,
    per_page: 100
  });

  const botChecks = checks.data.check_runs
    .filter((check) => check.name === CHECK_RUN_NAME)
    .sort((left, right) => {
      const leftTime = left.started_at ? Date.parse(left.started_at) : 0;
      const rightTime = right.started_at ? Date.parse(right.started_at) : 0;
      return rightTime - leftTime;
    });

  for (const check of botChecks) {
    const outcome = parseReviewExternalId(check.external_id);
    if (outcome) {
      return outcome;
    }
  }

  return null;
}

async function listPullRequestFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PullRequestFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100
  });

  return files.map((file) => ({
    filename: file.filename,
    patch: file.patch,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions
  }));
}

async function submitReview(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    commitId: string;
    files: PullRequestFile[];
    decision: ReviewDecision;
    mode: ReviewMode;
  }
): Promise<void> {
  const validLines = collectValidNewLines(params.files);
  const filesByPath = new Map(params.files.map((file) => [file.filename, file]));
  const disposition = evaluateReviewDecision(params.decision);
  const currentReviewIds: number[] = [];

  for (const phase of buildReviewSubmissionPlan(params.decision, disposition)) {
    const unpostedFindings: CategorizedFinding[] = [];
    const comments = phase.findings.flatMap((finding) => {
      const file = filesByPath.get(finding.path);
      if (!file) {
        unpostedFindings.push(finding);
        return [];
      }

      const position = toDiffPosition(file, finding.line, validLines);
      if (!position) {
        unpostedFindings.push(finding);
        return [];
      }

      return [
        {
          path: position.path,
          line: position.line,
          side: position.side,
          body: `**${finding.category === "change" ? "Required change" : "Review note"}: ${finding.title}**\n\n${finding.body}`
        }
      ];
    });

    const body =
      phase.phase === "final"
        ? formatReviewBody(params.decision, [], params.mode, disposition)
        : formatFindingReviewBody(
            params.decision,
            phase.phase,
            unpostedFindings,
            params.mode,
            disposition
          );
    const reviewId = await createGitHubReview(octokit, {
      owner: params.owner,
      repo: params.repo,
      pullNumber: params.pullNumber,
      commitId: params.commitId,
      event: phase.event,
      body,
      comments,
      logContext: {
        owner: params.owner,
        repo: params.repo,
        pullNumber: params.pullNumber,
        commitId: params.commitId
      }
    });
    currentReviewIds.push(reviewId);
  }

  await supersedePreviousBotReviews(octokit, {
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
    currentReviewIds,
    currentCommitId: params.commitId
  });
}

export type ReviewSubmissionPhase = {
  phase: "change" | "review" | "final";
  event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
  findings: CategorizedFinding[];
};

export function buildReviewSubmissionPlan(
  decision: ReviewDecision,
  disposition: { event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES" }
): ReviewSubmissionPhase[] {
  const phases: ReviewSubmissionPhase[] = [];
  if (decision.change.length > 0) {
    phases.push({
      phase: "change",
      event: "REQUEST_CHANGES",
      findings: decision.change.map((finding) => ({ ...finding, category: "change" as const }))
    });
  }
  if (decision.review.length > 0) {
    phases.push({
      phase: "review",
      event: "COMMENT",
      findings: decision.review.map((finding) => ({ ...finding, category: "review" as const }))
    });
  }
  phases.push({
    phase: "final",
    // Once a dedicated REQUEST_CHANGES review has been submitted, the final
    // summary must stay a comment so GitHub does not group review notes into
    // the change-request review.
    event: decision.change.length > 0 ? "COMMENT" : disposition.event,
    findings: []
  });
  return phases;
}

async function createGitHubReview(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    commitId: string;
    event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
    body: string;
    comments: Array<{
      path: string;
      line: number;
      side: "LEFT" | "RIGHT";
      body: string;
    }>;
    logContext: { owner: string; repo: string; pullNumber: number; commitId: string };
  }
): Promise<number> {
  try {
    const response = await withRetry("github.pulls.createReview", async () => {
      return octokit.rest.pulls.createReview({
        owner: params.owner,
        repo: params.repo,
        pull_number: params.pullNumber,
        commit_id: params.commitId,
        event: params.event,
        body: params.body,
        comments: params.comments
      });
    });
    return response.data.id;
  } catch (error) {
    if (!shouldFallbackToCommentReview(error, params.event)) {
      throw error;
    }

    logger.warn(
      { error, ...params.logContext },
      "Falling back to COMMENT review because the current token is not allowed to approve pull requests."
    );

    const response = await withRetry("github.pulls.createReview.commentFallback", async () => {
      return octokit.rest.pulls.createReview({
        owner: params.owner,
        repo: params.repo,
        pull_number: params.pullNumber,
        commit_id: params.commitId,
        event: "COMMENT",
        body: params.body,
        comments: params.comments
      });
    });
    return response.data.id;
  }
}

async function upsertReviewCheckRun(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    headSha: string;
    pullNumber: number;
    decision: ReviewDecision;
    mode: ReviewMode;
  }
): Promise<void> {
  const disposition = evaluateReviewDecision(params.decision);
  const conclusion =
    disposition.blocksMerge || disposition.requiresAdminApproval ? "action_required" : "success";

  await withRetry("github.checks.create", async () => {
    return octokit.rest.checks.create({
      owner: params.owner,
      repo: params.repo,
      name: CHECK_RUN_NAME,
      head_sha: params.headSha,
      status: "completed",
      conclusion,
      external_id: formatReviewExternalId(params.mode, disposition),
      output: {
        title: params.decision.result.shouldClosePullRequest
          ? "Malicious code detected"
          : disposition.requiresAdminApproval
            ? "Review notes require administrator approval"
            : `${params.mode === "strict" ? "Strict" : "Normal"} review completed`,
        summary: params.decision.result.shouldClosePullRequest
          ? `${params.decision.result.summary}\n\nClose reason: ${params.decision.result.closeReason}`
          : params.decision.result.summary
      },
      details_url: `https://github.com/${params.owner}/${params.repo}/pull/${params.pullNumber}`
    });
  });
}

async function markReviewCheckApproved(
  octokit: Octokit,
  params: { owner: string; repo: string; headSha: string; pullNumber: number }
): Promise<void> {
  const checks = await octokit.rest.checks.listForRef({
    owner: params.owner,
    repo: params.repo,
    ref: params.headSha,
    check_name: CHECK_RUN_NAME,
    per_page: 100
  });
  const check = checks.data.check_runs
    .filter((item) => item.name === CHECK_RUN_NAME)
    .sort(
      (left, right) => Date.parse(right.started_at ?? "") - Date.parse(left.started_at ?? "")
    )[0];

  if (!check) {
    throw new Error(`Could not find ${CHECK_RUN_NAME} check for ${params.headSha}.`);
  }

  await withRetry("github.checks.update.adminApproved", async () => {
    return octokit.rest.checks.update({
      owner: params.owner,
      repo: params.repo,
      check_run_id: check.id,
      status: "completed",
      conclusion: "success",
      external_id: check.external_id ?? undefined,
      output: {
        title: "Repository administrator approved review notes",
        summary:
          "The current pull request head has the administrator approval required by REVIEW_POLICY=require_approval."
      },
      details_url: `https://github.com/${params.owner}/${params.repo}/pull/${params.pullNumber}`
    });
  });
}

export function isRecheckComment(body: string): boolean {
  return body.trim() === RECHECK_COMMENT_COMMAND;
}

export function isConflictComment(body: string): boolean {
  return body.trim() === CONFLICT_COMMENT_COMMAND;
}

async function closeMaliciousPullRequest(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    reason: string;
  }
): Promise<void> {
  await withRetry("github.issues.createComment.closeMalicious", async () => {
    return octokit.rest.issues.createComment({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.pullNumber,
      body: `This PR was automatically closed because the review detected clearly malicious code.\n\nReason: ${params.reason}`
    });
  });

  await withRetry("github.pulls.update.closeMalicious", async () => {
    return octokit.rest.pulls.update({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.pullNumber,
      state: "closed"
    });
  });
}

async function waitForMergeable(octokit: Octokit, owner: string, repo: string, pullNumber: number) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber
    });

    if (data.mergeable !== null) {
      return data;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  });
  return data;
}

export async function supersedePreviousBotReviews(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    currentReviewId?: number;
    currentReviewIds?: number[];
    currentCommitId: string;
  }
): Promise<void> {
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber,
    per_page: 100
  });

  const currentReviewIds = new Set([
    ...(params.currentReviewIds ?? []),
    ...(params.currentReviewId ? [params.currentReviewId] : [])
  ]);

  for (const review of reviews) {
    if (review.user?.type !== "Bot" || !parseReviewStateMarker(review.body)) {
      continue;
    }

    if (!review.id || currentReviewIds.has(review.id)) {
      continue;
    }

    const oldCommitId = review.commit_id ?? "unknown";
    try {
      const comments = await octokit.paginate(octokit.rest.pulls.listCommentsForReview, {
        owner: params.owner,
        repo: params.repo,
        pull_number: params.pullNumber,
        review_id: review.id,
        per_page: 100
      });
      const commentsWithNodeIds = comments.filter(
        (comment): comment is typeof comment & { node_id: string } => Boolean(comment.node_id)
      );
      const commentsToDelete = new Set(
        comments.filter((comment) => !comment.node_id).map((comment) => comment.id)
      );
      if (commentsWithNodeIds.length > 0) {
        let resolvedCommentNodeIds = new Set<string>();
        try {
          resolvedCommentNodeIds = await withRetry(
            "github.graphql.resolveReviewThread.superseded",
            async () =>
              resolveReviewThreadsForComments(octokit, {
                owner: params.owner,
                repo: params.repo,
                pullNumber: params.pullNumber,
                commentNodeIds: commentsWithNodeIds.map((comment) => comment.node_id)
              })
          );
        } catch (error) {
          logger.warn(
            {
              error,
              owner: params.owner,
              repo: params.repo,
              pullNumber: params.pullNumber,
              reviewId: review.id
            },
            "Could not resolve superseded review threads through GraphQL; deleting only the affected inline comments."
          );
        }

        // A comment not returned from the thread connection cannot be resolved
        // by its REST id. Delete only that exceptional remainder so one stale
        // API response does not leave old inline findings permanently active.
        for (const comment of commentsWithNodeIds) {
          if (!resolvedCommentNodeIds.has(comment.node_id)) {
            commentsToDelete.add(comment.id);
          }
        }
      }

      for (const commentId of commentsToDelete) {
        await withRetry("github.pulls.deleteReviewComment.superseded", async () => {
          return octokit.rest.pulls.deleteReviewComment({
            owner: params.owner,
            repo: params.repo,
            comment_id: commentId
          });
        });
      }

      await withRetry("github.pulls.updateReview.superseded", async () => {
        return octokit.rest.pulls.updateReview({
          owner: params.owner,
          repo: params.repo,
          pull_number: params.pullNumber,
          review_id: review.id,
          body: formatSupersededReviewBody({
            originalMarker: extractReviewStateMarker(review.body),
            oldCommitId,
            currentCommitId: params.currentCommitId
          })
        });
      });

      if (review.state !== "DISMISSED") {
        await withRetry("github.pulls.dismissReview.superseded", async () => {
          return octokit.rest.pulls.dismissReview({
            owner: params.owner,
            repo: params.repo,
            pull_number: params.pullNumber,
            review_id: review.id,
            message: `Superseded by the automated review for commit ${shortSha(params.currentCommitId)}.`
          });
        });
      }

      await withRetry("github.graphql.minimizeReview.superseded", async () => {
        return octokit.graphql(
          `mutation MinimizeSupersededReview($subjectId: ID!) {
            minimizeComment(input: { subjectId: $subjectId, classifier: OUTDATED }) {
              minimizedComment {
                isMinimized
              }
            }
          }`,
          { subjectId: review.node_id }
        );
      });
    } catch (error) {
      logger.warn(
        {
          error,
          owner: params.owner,
          repo: params.repo,
          pullNumber: params.pullNumber,
          reviewId: review.id
        },
        "Failed to fully remove a superseded bot review."
      );
    }
  }
}

export function formatSupersededReviewBody(params: {
  originalMarker: string;
  oldCommitId: string;
  currentCommitId: string;
}): string {
  return [
    params.originalMarker,
    "## Superseded automated review",
    "",
    `The review for commit \`${shortSha(params.oldCommitId)}\` has been replaced by the automated review for commit \`${shortSha(params.currentCommitId)}\`.`,
    "",
    "Its previous inline `review` and `change` threads were marked as resolved and hidden. Refer to the latest commit review for the current result."
  ].join("\n");
}

async function resolveReviewThreadsForComments(
  octokit: Octokit,
  params: { owner: string; repo: string; pullNumber: number; commentNodeIds: string[] }
): Promise<Set<string>> {
  type ReviewThreadsResponse = {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: Array<{
            id: string;
            isResolved: boolean;
            comments?: { nodes?: Array<{ id: string }> } | null;
          } | null>;
          pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        } | null;
      } | null;
    } | null;
  };

  const targetCommentNodeIds = new Set(params.commentNodeIds);
  const matchedCommentNodeIds = new Set<string>();
  let after: string | null = null;

  do {
    const result: ReviewThreadsResponse = await octokit.graphql<ReviewThreadsResponse>(
      `query ReviewThreadsForSupersededReview($owner: String!, $repo: String!, $pullNumber: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pullNumber) {
            reviewThreads(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                comments(first: 100) {
                  nodes { id }
                }
              }
            }
          }
        }
      }`,
      { owner: params.owner, repo: params.repo, pullNumber: params.pullNumber, after }
    );

    const threads = result.repository?.pullRequest?.reviewThreads;
    if (!threads) {
      break;
    }

    for (const thread of threads.nodes ?? []) {
      if (!thread) {
        continue;
      }
      const threadCommentNodeIds = (thread.comments?.nodes ?? [])
        .map((comment) => comment?.id)
        .filter((commentId): commentId is string => typeof commentId === "string");
      const matchingCommentNodeIds = threadCommentNodeIds.filter((commentId) =>
        targetCommentNodeIds.has(commentId)
      );
      if (matchingCommentNodeIds.length === 0) {
        continue;
      }
      let threadResolved = thread.isResolved;
      if (!threadResolved) {
        try {
          await withRetry("github.graphql.resolveReviewThread.superseded.item", async () => {
            return octokit.graphql(
              `mutation ResolveReviewThread($threadId: ID!) {
                resolveReviewThread(input: { threadId: $threadId }) {
                  thread { isResolved }
                }
              }`,
              { threadId: thread.id }
            );
          });
          threadResolved = true;
        } catch (error) {
          logger.warn(
            { error, threadId: thread.id },
            "Could not resolve a superseded review thread."
          );
        }
      }

      if (!threadResolved) {
        continue;
      }

      for (const commentNodeId of matchingCommentNodeIds) {
        matchedCommentNodeIds.add(commentNodeId);
        try {
          await withRetry("github.graphql.minimizeResolvedReviewComment.superseded", async () => {
            return octokit.graphql(
              `mutation MinimizeSupersededInlineComment($subjectId: ID!) {
                minimizeComment(input: { subjectId: $subjectId, classifier: RESOLVED }) {
                  minimizedComment { isMinimized }
                }
              }`,
              { subjectId: commentNodeId }
            );
          });
        } catch (error) {
          // Resolution succeeded, so keep the comment rather than deleting it
          // merely because the optional visual minimization failed.
          logger.warn(
            { error, commentNodeId },
            "Could not hide a resolved superseded review comment."
          );
        }
      }
    }

    after = threads.pageInfo.hasNextPage ? (threads.pageInfo.endCursor ?? null) : null;
  } while (after);

  return matchedCommentNodeIds;
}

function extractReviewStateMarker(body: string | null | undefined): string {
  return (
    body?.match(/<!-- ghbot-review:v1[^>]*-->/)?.[0] ?? "<!-- ghbot-review:v1 superseded=true -->"
  );
}

function shouldFallbackToCommentReview(
  error: unknown,
  event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES"
): boolean {
  if (event !== "APPROVE") {
    return false;
  }

  if (typeof error !== "object" || error === null || !("status" in error) || error.status !== 422) {
    return false;
  }

  if (!("message" in error) || typeof error.message !== "string") {
    return false;
  }

  return error.message.includes("GitHub Actions is not permitted to approve pull requests.");
}
