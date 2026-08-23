import fs from "node:fs";
import { config } from "../config.js";
import { createGitHubCredentials } from "../github/client.js";
import { createEventLogger, logger } from "../logger.js";
import { loadRepositoryKnowledge } from "../repository/knowledge.js";
import { restorePersistentCache, savePersistentCache } from "../storage/cacheStore.js";
import { buildDefaultEventRouter } from "./router.js";

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

type GitHubEventPayload =
  | PullRequestPayload
  | IssuePayload
  | IssueCommentPayload
  | PullRequestReviewPayload
  | ScheduledPayload;

async function main(): Promise<void> {
  const workflowCallEventName = process.env.GHBOT_EVENT_NAME;
  const payload = workflowCallEventName
    ? buildPayloadFromWorkflowCallEnv(workflowCallEventName)
    : readPayloadFromGitHubEventPath();
  const repository = payload.repository;
  const eventName = workflowCallEventName ?? process.env.GITHUB_EVENT_NAME;

  if (!eventName) {
    throw new Error("GITHUB_EVENT_NAME is required.");
  }

  const pullNumberForCache = getPullNumberForCache(eventName, payload);
  const eventLogger = createEventLogger({
    eventName,
    owner: repository.owner.login,
    repo: repository.name,
    pullNumber: pullNumberForCache
  });
  const persistentCache = {
    repositoryId: process.env.GHBOT_REPOSITORY_ID || String(repository.id ?? ""),
    owner: repository.owner.login,
    repo: repository.name,
    pullNumber: pullNumberForCache,
    prefix: config.r2Prefix
  };
  let persistentCacheRestored = false;
  await restorePersistentCache(persistentCache)
    .then(() => {
      persistentCacheRestored = true;
    })
    .catch((error: unknown) => {
      logger.warn(
        { error, eventName },
        "Persistent R2 cache restore failed; continuing without it."
      );
    });
  let repositoryKnowledgeBefore: string | undefined;
  if (config.repositoryKnowledgeEnabled) {
    repositoryKnowledgeBefore = await loadRepositoryKnowledge().catch((error: unknown) => {
      logger.warn(
        { error, eventName },
        "Repository knowledge initialization failed; continuing without it."
      );
      return undefined;
    });
  }

  const github = await createGitHubCredentials({
    owner: repository.owner.login,
    repo: repository.name
  });
  const octokit = github.octokit;

  eventLogger.info("Handling GitHub Actions review event.");

  let eventFailed = false;
  try {
    const router = buildDefaultEventRouter();
    const action = "action" in payload ? payload.action : undefined;
    const dispatchResult = await router.dispatch({
      eventName,
      action,
      payload: payload as unknown as Record<string, unknown>,
      octokit,
      gitToken: github.token
    });

    if (!dispatchResult.handled) {
      logger.warn({ eventName }, "Unhandled GitHub Actions event.");
    }
  } catch (error) {
    eventFailed = true;
    throw error;
  } finally {
    if (!eventFailed) {
      const repositoryKnowledgeAfter =
        persistentCacheRestored && repositoryKnowledgeBefore !== undefined
          ? await loadRepositoryKnowledge().catch((error: unknown) => {
              logger.warn(
                { error, eventName },
                "Repository knowledge comparison failed; skipping its R2 update."
              );
              return undefined;
            })
          : undefined;
      await savePersistentCache({
        ...persistentCache,
        saveRepositoryKnowledge:
          repositoryKnowledgeAfter !== undefined &&
          repositoryKnowledgeAfter !== repositoryKnowledgeBefore
      }).catch((error: unknown) => {
        logger.warn(
          { error, eventName },
          "Persistent R2 cache save failed; review results remain valid for this run."
        );
      });
    }
  }
}

function getPullNumberForCache(eventName: string, payload: GitHubEventPayload): number | undefined {
  if (eventName === "pull_request_target") {
    return (payload as PullRequestPayload).pull_request.number;
  }
  if (eventName === "issue_comment") {
    const commentPayload = payload as IssueCommentPayload;
    return commentPayload.issue.pull_request ? commentPayload.issue.number : undefined;
  }
  if (eventName === "pull_request_review") {
    return (payload as PullRequestReviewPayload).pull_request.number;
  }
  return undefined;
}

function readPayloadFromGitHubEventPath(): GitHubEventPayload {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is required when workflow_call inputs are not provided.");
  }

  return JSON.parse(fs.readFileSync(eventPath, "utf8")) as GitHubEventPayload;
}

function buildPayloadFromWorkflowCallEnv(eventName: string): GitHubEventPayload {
  const action = process.env.GHBOT_EVENT_ACTION;
  const owner = process.env.GHBOT_REPOSITORY_OWNER;
  const repo = process.env.GHBOT_REPOSITORY_NAME;
  const pullNumber = Number(process.env.GHBOT_PULL_NUMBER);

  if (!action || !owner || !repo || !Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw new Error("Missing required GHBOT_* workflow_call inputs.");
  }

  const repository = {
    id: Number(process.env.GHBOT_REPOSITORY_ID) || undefined,
    name: repo,
    owner: {
      login: owner
    },
    full_name: `${owner}/${repo}`
  };

  if (eventName === "pull_request_target") {
    return {
      action,
      pull_request: {
        number: pullNumber,
        draft: false
      },
      repository
    };
  }

  if (eventName === "issue_comment") {
    return {
      action,
      issue: {
        number: pullNumber,
        pull_request: {
          url: `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`
        }
      },
      comment: {
        id: Number(process.env.GHBOT_COMMENT_ID) || 0,
        body: process.env.GHBOT_COMMENT_BODY ?? "",
        user: {
          login: process.env.GHBOT_COMMENTER_LOGIN ?? ""
        }
      },
      repository
    };
  }

  if (eventName === "issues") {
    return {
      action,
      issue: {
        number: pullNumber
      },
      repository
    };
  }

  if (eventName === "pull_request_review") {
    return {
      action,
      review: {
        state: process.env.GHBOT_REVIEW_STATE ?? "",
        commit_id: process.env.GHBOT_REVIEW_COMMIT_ID ?? "",
        user: {
          login: process.env.GHBOT_REVIEWER_LOGIN ?? ""
        }
      },
      pull_request: {
        number: pullNumber
      },
      repository
    };
  }

  if (eventName === "schedule") {
    return {
      repository
    };
  }

  throw new Error(`Unsupported GHBOT_EVENT_NAME: ${eventName}`);
}

main().catch((error) => {
  logger.error({ error, botName: config.botName }, "GitHub Actions review run failed.");
  process.exitCode = 1;
});
