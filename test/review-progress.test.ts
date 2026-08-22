import assert from "node:assert/strict";
import test from "node:test";
import type { Octokit } from "@octokit/rest";
import { beginCommitReviewProgress, finishCommitReviewProgress } from "../src/review/processor.js";

const headSha = "1234567890abcdef1234567890abcdef12345678";
const reviewMarker =
  "<!-- ghbot-review:v1 mode=normal outcome=pass requires-admin=false review=0 change=0 -->";

test("new commit progress is created once and reused for the same head", async () => {
  const comments: Array<{ id: number; body: string }> = [];
  const created: string[] = [];
  const updated: Array<{ comment_id: number; body: string }> = [];
  const pullsGet = async () => ({
    data: {
      state: "open",
      draft: false,
      head: { sha: headSha }
    }
  });
  const issuesListComments = async () => ({ data: comments });
  const octokit = {
    paginate: async (method: unknown) => {
      assert.equal(method, issuesListComments);
      return comments;
    },
    rest: {
      pulls: { get: pullsGet },
      issues: {
        listComments: issuesListComments,
        createComment: async ({ body }: { body: string }) => {
          created.push(body);
          const comment = { id: 77, body };
          comments.push(comment);
          return { data: comment };
        },
        updateComment: async ({ comment_id, body }: { comment_id: number; body: string }) => {
          updated.push({ comment_id, body });
          const comment = comments.find((item) => item.id === comment_id);
          if (comment) {
            comment.body = body;
          }
          return { data: { id: comment_id, body } };
        }
      }
    }
  } as unknown as Octokit;

  const params = { owner: "forumlify", repo: "public", pullNumber: 17 };
  const first = await beginCommitReviewProgress(octokit, params);
  const second = await beginCommitReviewProgress(octokit, params);

  assert.deepEqual(first, { commentId: 77, headSha });
  assert.deepEqual(second, first);
  assert.equal(created.length, 1);
  assert.equal(updated.length, 1);
  assert.match(created[0]!, /ghbot-review-progress:v1 head=1234567890abcdef/);
  assert.match(created[0]!, /New commit `1234567890ab` detected/);
});

test("completed progress updates the same comment after a review is published for the head", async () => {
  const updated: Array<{ comment_id: number; body: string }> = [];
  const reviews = [
    { commit_id: "f".repeat(40), body: reviewMarker },
    { commit_id: headSha, body: reviewMarker }
  ];
  const pullsListReviews = async () => ({ data: reviews });
  const octokit = {
    paginate: async (method: unknown) => {
      assert.equal(method, pullsListReviews);
      return reviews;
    },
    rest: {
      pulls: { listReviews: pullsListReviews },
      issues: {
        updateComment: async ({ comment_id, body }: { comment_id: number; body: string }) => {
          updated.push({ comment_id, body });
          return { data: { id: comment_id, body } };
        }
      }
    }
  } as unknown as Octokit;

  await finishCommitReviewProgress(octokit, {
    owner: "forumlify",
    repo: "public",
    pullNumber: 17,
    commentId: 77,
    headSha
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0]!.comment_id, 77);
  assert.match(updated[0]!.body, /Automated review completed/);
  assert.match(updated[0]!.body, /`ghbot review` check now reflect this commit/);
});

test("completed progress reports a stale run when the reviewed head was not published", async () => {
  const updated: string[] = [];
  const pullsListReviews = async () => ({ data: [] });
  const octokit = {
    paginate: async () => [],
    rest: {
      pulls: { listReviews: pullsListReviews },
      issues: {
        updateComment: async ({ body }: { body: string }) => {
          updated.push(body);
          return { data: { id: 77, body } };
        }
      }
    }
  } as unknown as Octokit;

  await finishCommitReviewProgress(octokit, {
    owner: "forumlify",
    repo: "public",
    pullNumber: 17,
    commentId: 77,
    headSha
  });

  assert.match(updated[0]!, /ended without publishing a result/);
  assert.match(updated[0]!, /newest commit will be reviewed separately/);
});
