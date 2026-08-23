import type { Octokit } from "@octokit/rest";
import type { PullRequestFile } from "../types.js";

/**
 * Shared paginated PR file listing used by the review processor, the PR chat
 * snapshot flow, and the webhook context loader.
 */
export async function listPullRequestFiles(
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
