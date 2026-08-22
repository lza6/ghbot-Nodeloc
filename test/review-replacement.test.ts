import assert from "node:assert/strict";
import test from "node:test";
import type { Octokit } from "@octokit/rest";
import {
  buildReviewSubmissionPlan,
  formatSupersededReviewBody,
  supersedePreviousBotReviews
} from "../src/review/processor.js";
import type { ReviewDecision } from "../src/types.js";

const marker =
  "<!-- ghbot-review:v1 mode=normal outcome=block requires-admin=false review=1 change=1 -->";

const decisionWithBothFindingKinds: ReviewDecision = {
  review: [
    { path: "src/review.ts", line: 12, title: "Clarify this branch", body: "This is non-blocking." }
  ],
  change: [
    { path: "src/review.ts", line: 8, title: "Fix the null case", body: "This blocks merge." }
  ],
  comment: "The pull request needs one required fix and has one review note.",
  result: {
    canMerge: false,
    summary: "One required fix remains.",
    shouldClosePullRequest: false,
    closeReason: ""
  }
};

test("review submission keeps change requests, review notes, and final comment separate", () => {
  const phases = buildReviewSubmissionPlan(decisionWithBothFindingKinds, {
    event: "REQUEST_CHANGES"
  });

  assert.deepEqual(
    phases.map(({ phase, event, findings }) => ({
      phase,
      event,
      findings: findings.map((finding) => finding.category)
    })),
    [
      { phase: "change", event: "REQUEST_CHANGES", findings: ["change"] },
      { phase: "review", event: "COMMENT", findings: ["review"] },
      { phase: "final", event: "COMMENT", findings: [] }
    ]
  );
});

test("superseded review body removes old findings and points to the current commit", () => {
  const body = formatSupersededReviewBody({
    originalMarker: marker,
    oldCommitId: "a".repeat(40),
    currentCommitId: "b".repeat(40)
  });
  assert.match(body, /Superseded automated review/);
  assert.match(body, /`aaaaaaaaaaaa`/);
  assert.match(body, /`bbbbbbbbbbbb`/);
  assert.doesNotMatch(body, /Required changes:/);
  assert.match(body, /inline `review` and `change` threads were marked as resolved and hidden/);
});

test("old bot reviews are cleaned only while the current review is preserved", async () => {
  const deletedComments: number[] = [];
  const updatedReviews: Array<{ review_id: number; body: string }> = [];
  const dismissedReviews: number[] = [];
  const minimizedReviews: Array<{ subjectId: string; classifier: string }> = [];
  const reviews = [
    {
      id: 10,
      node_id: "PRR_10",
      user: { type: "Bot" },
      body: marker,
      state: "CHANGES_REQUESTED",
      commit_id: "a".repeat(40)
    },
    {
      id: 20,
      node_id: "PRR_20",
      user: { type: "Bot" },
      body: marker,
      state: "APPROVED",
      commit_id: "b".repeat(40)
    },
    {
      id: 30,
      node_id: "PRR_30",
      user: { type: "User" },
      body: marker,
      state: "COMMENTED",
      commit_id: "c".repeat(40)
    },
    {
      id: 40,
      node_id: "PRR_40",
      user: { type: "Bot" },
      body: marker,
      state: "DISMISSED",
      commit_id: "d".repeat(40)
    },
    {
      id: 50,
      node_id: "PRR_50",
      user: { type: "Bot" },
      body: "Unrelated automation",
      state: "COMMENTED",
      commit_id: "e".repeat(40)
    },
    {
      id: 60,
      node_id: "PRR_60",
      user: { type: "Bot" },
      body: marker,
      state: "CHANGES_REQUESTED",
      commit_id: "b".repeat(40)
    }
  ];
  const octokit = {
    paginate: async (method: unknown, params: { review_id?: number }) => {
      if (method === pulls.listReviews) {
        return reviews;
      }
      if (params.review_id === 10) {
        return [{ id: 101 }, { id: 102 }];
      }
      if (params.review_id === 40) {
        return [{ id: 401 }];
      }
      if (params.review_id === 60) {
        return [{ id: 601 }];
      }
      return [];
    },
    rest: {
      pulls: {
        listReviews: async () => ({ data: reviews }),
        listCommentsForReview: async () => ({ data: [] }),
        deleteReviewComment: async ({ comment_id }: { comment_id: number }) => {
          deletedComments.push(comment_id);
          return { data: undefined };
        },
        updateReview: async ({ review_id, body }: { review_id: number; body: string }) => {
          updatedReviews.push({ review_id, body });
          return { data: {} };
        },
        dismissReview: async ({ review_id }: { review_id: number }) => {
          dismissedReviews.push(review_id);
          return { data: {} };
        }
      }
    },
    graphql: async (query: string, variables: { subjectId: string }) => {
      assert.match(query, /classifier: OUTDATED/);
      minimizedReviews.push({ subjectId: variables.subjectId, classifier: "OUTDATED" });
      return { minimizeComment: { minimizedComment: { isMinimized: true } } };
    }
  } as unknown as Octokit;
  const pulls = (octokit.rest as unknown as { pulls: { listReviews: unknown } }).pulls;

  await supersedePreviousBotReviews(octokit, {
    owner: "forumlify",
    repo: "public",
    pullNumber: 17,
    currentReviewId: 20,
    currentCommitId: "b".repeat(40)
  });

  assert.deepEqual(deletedComments, [101, 102, 401, 601]);
  assert.deepEqual(
    updatedReviews.map((item) => item.review_id),
    [10, 40, 60]
  );
  assert.match(updatedReviews[0]!.body, /bbbbbbbbbbbb/);
  assert.deepEqual(dismissedReviews, [10, 60]);
  assert.deepEqual(minimizedReviews, [
    { subjectId: "PRR_10", classifier: "OUTDATED" },
    { subjectId: "PRR_40", classifier: "OUTDATED" },
    { subjectId: "PRR_60", classifier: "OUTDATED" }
  ]);
  assert.ok(pulls.listReviews);
});

test("superseded inline comments are marked resolved and hidden when GitHub exposes review threads", async () => {
  const deletedComments: number[] = [];
  const resolvedThreads: string[] = [];
  const hiddenComments: string[] = [];
  const reviews = [
    {
      id: 10,
      node_id: "PRR_10",
      user: { type: "Bot" },
      body: marker,
      state: "CHANGES_REQUESTED",
      commit_id: "a".repeat(40)
    },
    {
      id: 20,
      node_id: "PRR_20",
      user: { type: "Bot" },
      body: marker,
      state: "COMMENTED",
      commit_id: "b".repeat(40)
    }
  ];
  const octokit = {
    paginate: async (method: unknown, params: { review_id?: number }) => {
      if (method === pulls.listReviews) {
        return reviews;
      }
      if (params.review_id === 10) {
        return [
          { id: 101, node_id: "PRC_101" },
          { id: 102, node_id: "PRC_102" }
        ];
      }
      return [];
    },
    rest: {
      pulls: {
        listReviews: async () => ({ data: reviews }),
        listCommentsForReview: async () => ({ data: [] }),
        deleteReviewComment: async ({ comment_id }: { comment_id: number }) => {
          deletedComments.push(comment_id);
          return { data: undefined };
        },
        updateReview: async () => ({ data: {} }),
        dismissReview: async () => ({ data: {} })
      }
    },
    graphql: async (query: string, variables: { subjectId?: string; threadId?: string }) => {
      if (query.includes("query ReviewThreadsForSupersededReview")) {
        return {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "THREAD_PRC_101",
                    isResolved: false,
                    comments: { nodes: [{ id: "PRC_101" }] }
                  },
                  {
                    id: "THREAD_PRC_102",
                    isResolved: false,
                    comments: { nodes: [{ id: "PRC_102" }] }
                  }
                ],
                pageInfo: { hasNextPage: false, endCursor: null }
              }
            }
          }
        };
      }
      if (query.includes("mutation ResolveReviewThread")) {
        resolvedThreads.push(variables.threadId!);
      }
      if (query.includes("mutation MinimizeSupersededInlineComment")) {
        assert.match(query, /classifier: RESOLVED/);
        hiddenComments.push(variables.subjectId!);
      }
      return { resolveReviewThread: { thread: { isResolved: true } } };
    }
  } as unknown as Octokit;
  const pulls = (octokit.rest as unknown as { pulls: { listReviews: unknown } }).pulls;

  await supersedePreviousBotReviews(octokit, {
    owner: "forumlify",
    repo: "public",
    pullNumber: 17,
    currentReviewId: 20,
    currentCommitId: "b".repeat(40)
  });

  assert.deepEqual(deletedComments, []);
  assert.deepEqual(resolvedThreads, ["THREAD_PRC_101", "THREAD_PRC_102"]);
  assert.deepEqual(hiddenComments, ["PRC_101", "PRC_102"]);
});
