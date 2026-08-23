import type { Octokit } from "@octokit/rest";
import { withRetry } from "../retry.js";

export type RepositoryCommand = "/recheck" | "/conflict" | "@bot";

export function formatPermissionDeniedMessage(
  commenterLogin: string,
  command: RepositoryCommand
): string {
  return [
    `Hi! @${commenterLogin}, we're sorry that you don't have permission to run \`${command}\`.`,
    "Only repository collaborators with **write**, **maintain**, or **admin** permission can run this command.",
    "Please ask a repository maintainer to run it for you."
  ].join(" ");
}

export function formatCommandAckMessage(
  commenterLogin: string,
  actorName: string,
  command: "/recheck" | "/conflict"
): string {
  if (command === "/recheck") {
    return [
      `${actorName} received \`/recheck\` requested by @${commenterLogin}.`,
      "The full review is running now with the repository's current strictness settings; the result will be posted in this conversation when it completes."
    ].join(" ");
  }
  return [
    `${actorName} received \`/conflict\` requested by @${commenterLogin}.`,
    "Conflict repair can take up to 45 minutes (editing, isolated validation, and a final safety confirmation). A follow-up comment will report the outcome, and nothing is pushed unless every guard passes."
  ].join(" ");
}

export async function postPermissionDeniedComment(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pullNumber: number;
    sourceCommentId: number;
    commenterLogin: string;
    command: RepositoryCommand;
  }
): Promise<void> {
  const marker = `<!-- ghbot-permission-denied:v1 comment=${params.sourceCommentId} command=${encodeURIComponent(params.command)} -->`;
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: params.owner,
    repo: params.repo,
    issue_number: params.pullNumber,
    per_page: 100
  });
  if (comments.some((comment) => comment.body?.includes(marker))) {
    return;
  }

  await withRetry("github.issues.createComment.permissionDenied", async () => {
    return octokit.rest.issues.createComment({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.pullNumber,
      body: `${marker}\n${formatPermissionDeniedMessage(params.commenterLogin, params.command)}`
    });
  });
}
