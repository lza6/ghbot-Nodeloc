import type { Octokit } from "@octokit/rest";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { withRetry } from "../retry.js";
import { processPullRequestChat } from "../chat/processor.js";
import { processIssueTriage, processPullRequestTriage } from "../triage/processor.js";
import { deleteLocalReviewCache } from "../review/cache.js";
import {
  beginCommitReviewProgress,
  finishCommitReviewProgress,
  processConflictComment,
  processRecheckComment,
  processPullRequest,
  processScheduledPendingMerges,
  processPullRequestReviewApproval,
  shouldReviewPullRequest
} from "../review/processor.js";

export type EventContext = {
  eventName: string;
  action?: string;
  payload: Record<string, unknown>;
  octokit: Octokit;
  gitToken?: string;
};

export type EventHandler = {
  name: string;
  canHandle: (eventName: string, action?: string) => boolean;
  handle: (context: EventContext) => Promise<void>;
};

export class EventRouter {
  private readonly handlers: EventHandler[] = [];

  register(handler: EventHandler): this {
    this.handlers.push(handler);
    return this;
  }

  async dispatch(context: EventContext): Promise<{ handled: boolean; handlerName?: string }> {
    for (const handler of this.handlers) {
      if (handler.canHandle(context.eventName, context.action)) {
        logger.info(
          { eventName: context.eventName, action: context.action, handler: handler.name },
          "Dispatching event to registered handler."
        );
        await handler.handle(context);
        return { handled: true, handlerName: handler.name };
      }
    }

    logger.warn(
      { eventName: context.eventName, action: context.action },
      "No registered handler matched the event."
    );
    return { handled: false };
  }
}

type GitHubRepository = {
  id?: number;
  name: string;
  owner: {
    login: string;
  };
  full_name: string;
};

type PullRequestPayload = {
  action: string;
  pull_request: {
    number: number;
    draft: boolean;
  };
  repository: GitHubRepository;
};

type IssueCommentPayload = {
  action: string;
  issue: {
    number: number;
    pull_request?: {
      url: string;
    };
  };
  comment: {
    id: number;
    body: string;
    user: {
      login: string;
      type?: string;
    };
  };
  repository: GitHubRepository;
};

type IssuePayload = {
  action: string;
  issue: {
    number: number;
  };
  repository: GitHubRepository;
};

type PullRequestReviewPayload = {
  action: string;
  review: {
    state: string;
    commit_id: string;
    user?: {
      login?: string;
    };
  };
  pull_request: {
    number: number;
  };
  repository: GitHubRepository;
};

type ScheduledPayload = {
  repository: GitHubRepository;
};

export function buildDefaultEventRouter(): EventRouter {
  const router = new EventRouter();

  // 1. Pull Request Target
  router.register({
    name: "pull-request-target",
    canHandle: (eventName) => eventName === "pull_request_target",
    handle: async (ctx) => {
      const prPayload = ctx.payload as unknown as PullRequestPayload;
      const ref = {
        owner: prPayload.repository.owner.login,
        repo: prPayload.repository.name,
        pullNumber: prPayload.pull_request.number
      };

      if (["opened", "edited", "reopened"].includes(prPayload.action)) {
        try {
          await processPullRequestTriage(ctx.octokit, {
            owner: ref.owner,
            repo: ref.repo,
            pullNumber: ref.pullNumber
          });
        } catch (error) {
          logger.warn(
            { error, ...ref },
            "Pull request triage failed; continuing with code review."
          );
        }
      }

      if (!(await shouldReviewPullRequest(ctx.octokit, ref))) {
        await deleteLocalReviewCache(ref.pullNumber);
        logger.info({ ...ref }, "Skipping pull request event outside REVIEW_BRANCHES.");
        return;
      }

      if (prPayload.action === "opened") {
        await withRetry("github.issues.createComment.started", async () => {
          return ctx.octokit.rest.issues.createComment({
            owner: prPayload.repository.owner.login,
            repo: prPayload.repository.name,
            issue_number: prPayload.pull_request.number,
            body: "Automated review has started. I am checking this pull request now."
          });
        });
      }

      const progress =
        prPayload.action === "synchronize"
          ? await beginCommitReviewProgress(ctx.octokit, ref).catch((progressError: unknown) => {
              logger.warn(
                { error: progressError, ...ref },
                "Failed to publish review start progress; continuing review."
              );
              return undefined;
            })
          : undefined;

      try {
        await processPullRequest(
          ctx.octokit,
          ref,
          config.reviewStrictness === "strict" ? "strict" : "normal",
          ctx.gitToken
        );
      } catch (error) {
        if (progress) {
          await finishCommitReviewProgress(ctx.octokit, {
            ...ref,
            ...progress,
            failed: true
          }).catch((progressError: unknown) => {
            logger.warn(
              { error: progressError, ...ref },
              "Failed to publish review failure progress."
            );
          });
        }
        throw error;
      }

      if (progress) {
        await finishCommitReviewProgress(ctx.octokit, { ...ref, ...progress }).catch(
          (progressError: unknown) => {
            logger.warn(
              { error: progressError, ...ref },
              "Failed to publish review completion progress."
            );
          }
        );
      }
    }
  });

  // 2. Issues
  router.register({
    name: "issues-triage",
    canHandle: (eventName) => eventName === "issues",
    handle: async (ctx) => {
      const issuePayload = ctx.payload as unknown as IssuePayload;
      if (["opened", "edited", "reopened"].includes(issuePayload.action)) {
        await processIssueTriage(ctx.octokit, {
          owner: issuePayload.repository.owner.login,
          repo: issuePayload.repository.name,
          issueNumber: issuePayload.issue.number
        });
      }
    }
  });

  // 3. Issue Comment
  router.register({
    name: "issue-comment",
    canHandle: (eventName) => eventName === "issue_comment",
    handle: async (ctx) => {
      const commentPayload = ctx.payload as unknown as IssueCommentPayload;
      if (!commentPayload.issue.pull_request) {
        logger.info(
          { issueNumber: commentPayload.issue.number },
          "Skipping issue comment because it is not on a pull request."
        );
        return;
      }

      if (commentPayload.comment.user?.type === "Bot") {
        logger.info(
          { issueNumber: commentPayload.issue.number, login: commentPayload.comment.user.login },
          "Skipping bot-authored comment to prevent automation loops."
        );
        return;
      }

      const commentTasks: Array<[string, () => Promise<void>]> = [
        [
          "recheck",
          () =>
            processRecheckComment(ctx.octokit, {
              owner: commentPayload.repository.owner.login,
              repo: commentPayload.repository.name,
              pullNumber: commentPayload.issue.number,
              commentId: commentPayload.comment.id,
              commenterLogin: commentPayload.comment.user.login,
              commentBody: commentPayload.comment.body,
              gitToken: ctx.gitToken
            })
        ],
        [
          "conflict",
          () =>
            processConflictComment(ctx.octokit, {
              owner: commentPayload.repository.owner.login,
              repo: commentPayload.repository.name,
              pullNumber: commentPayload.issue.number,
              commentId: commentPayload.comment.id,
              commenterLogin: commentPayload.comment.user.login,
              commentBody: commentPayload.comment.body,
              gitToken: ctx.gitToken
            })
        ],
        [
          "chat",
          () =>
            processPullRequestChat(ctx.octokit, {
              owner: commentPayload.repository.owner.login,
              repo: commentPayload.repository.name,
              pullNumber: commentPayload.issue.number,
              commentId: commentPayload.comment.id,
              commenterLogin: commentPayload.comment.user.login,
              commentBody: commentPayload.comment.body
            })
        ]
      ];

      const results = await Promise.allSettled(commentTasks.map(([, run]) => run()));
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const [label] = commentTasks[index]!;
          logger.error(
            { error: result.reason, task: label, issueNumber: commentPayload.issue.number },
            "Comment command handler failed; other handlers still ran."
          );
        }
      });

      const rejectedResults = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (rejectedResults.length > 0) {
        throw new AggregateError(
          rejectedResults.map((result) => result.reason),
          "One or more issue comment handlers failed; GitHub Actions should retry this delivery."
        );
      }
    }
  });

  // 4. Pull Request Review
  router.register({
    name: "pull-request-review-approval",
    canHandle: (eventName: string) => eventName === "pull_request_review",
    handle: async (ctx: EventContext) => {
      const reviewPayload = ctx.payload as unknown as PullRequestReviewPayload;
      const reviewerLogin = reviewPayload.review.user?.login;
      if (!reviewerLogin) {
        logger.warn(
          { pullNumber: reviewPayload.pull_request.number },
          "Skipping review event without reviewer login."
        );
        return;
      }

      await processPullRequestReviewApproval(ctx.octokit, {
        owner: reviewPayload.repository.owner.login,
        repo: reviewPayload.repository.name,
        pullNumber: reviewPayload.pull_request.number,
        reviewerLogin,
        state: reviewPayload.review.state,
        commitId: reviewPayload.review.commit_id
      });
    }
  });

  // 5. Schedule
  router.register({
    name: "schedule-pending-merges",
    canHandle: (eventName: string) => eventName === "schedule",
    handle: async (ctx: EventContext) => {
      const scheduledPayload = ctx.payload as unknown as ScheduledPayload;
      await processScheduledPendingMerges(ctx.octokit, {
        owner: scheduledPayload.repository.owner.login,
        repo: scheduledPayload.repository.name
      });
    }
  });

  return router;
}
