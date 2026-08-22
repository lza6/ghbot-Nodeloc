import assert from "node:assert/strict";
import test from "node:test";
import type { Octokit } from "@octokit/rest";
import {
  buildPullRequestCoarsePrompt,
  buildPullRequestDuplicatePrompt,
  loadPullRequestEvidence,
  type PullRequestEvidence
} from "../src/triage/processor.js";

const target = {
  number: 42,
  title: "Add compact navigation",
  body: "Makes the mobile navigation smaller.",
  htmlUrl: "https://github.com/forumlify/public/pull/42",
  existingLabels: []
};

const candidates = [
  {
    number: 12,
    title: "Mobile header update",
    body: "Changes the mobile header.",
    state: "closed",
    htmlUrl: "https://github.com/forumlify/public/pull/12"
  },
  {
    number: 13,
    title: "Navigation accessibility",
    body: "Improves keyboard navigation.",
    state: "open",
    htmlUrl: "https://github.com/forumlify/public/pull/13"
  }
];

test("pull request coarse triage retrieves candidates without declaring a duplicate", () => {
  const prompt = buildPullRequestCoarsePrompt(target, candidates);

  assert.match(prompt, /first, coarse stage/);
  assert.match(prompt, /zero to 3 unique PR numbers/);
  assert.match(prompt, /Do not make or state a final duplicate determination/);
  assert.match(prompt, /"number": 12/);
  assert.match(prompt, /"number": 13/);
});

test("pull request fine triage compares commits and comments before deciding", () => {
  const targetEvidence = evidence(42, "target commit", "Target discussion narrows the scope.");
  const candidateEvidence = [
    evidence(12, "candidate commit", "This PR was superseded by a different approach."),
    evidence(13, "accessibility commit", "This only addresses keyboard behavior.")
  ];
  const prompt = buildPullRequestDuplicatePrompt({
    target,
    targetEvidence,
    candidates,
    candidateEvidence
  });

  assert.match(prompt, /second, detailed stage/);
  assert.match(prompt, /Read the commit history and the full bounded PR discussion evidence/);
  assert.match(prompt, /target commit/);
  assert.match(prompt, /superseded by a different approach/);
  assert.match(prompt, /accessibility commit/);
  assert.match(prompt, /shared component, file, dependency, symptom, or broad goal is not enough/);
});

test("pull request evidence loads bounded recent commits and all comment kinds", async () => {
  const calls: string[] = [];
  const octokit = {
    paginate: async (method: () => Promise<{ data: unknown[] }>) => {
      return (await method()).data;
    },
    rest: {
      pulls: {
        listCommits: async () => {
          calls.push("commits");
          return {
            data: Array.from({ length: 10 }, (_, index) => ({
              sha: `sha-${index}`,
              author: { login: `author-${index}` },
              commit: { message: `commit-${index}`, author: { name: `Author ${index}` } }
            }))
          };
        },
        listReviews: async () => {
          calls.push("reviews");
          return {
            data: [
              {
                user: { login: "reviewer" },
                state: "COMMENTED",
                body: "Review summary",
                submitted_at: "2026-08-14T00:00:00Z"
              }
            ]
          };
        },
        listReviewComments: async () => {
          calls.push("review-comments");
          return {
            data: [
              {
                user: { login: "inline-reviewer" },
                path: "src/navigation.ts",
                body: "Inline compatibility concern",
                created_at: "2026-08-14T00:01:00Z"
              }
            ]
          };
        }
      },
      issues: {
        listComments: async () => {
          calls.push("comments");
          return {
            data: [
              {
                user: { login: "maintainer" },
                body: "Conversation context",
                created_at: "2026-08-14T00:02:00Z"
              }
            ]
          };
        }
      }
    }
  } as unknown as Octokit;

  const result = await loadPullRequestEvidence(octokit, "forumlify", "public", 42);

  assert.deepEqual(calls.sort(), ["comments", "commits", "review-comments", "reviews"]);
  assert.equal(result.commits.length, 8);
  assert.equal(result.commits[0]!.sha, "sha-2");
  assert.equal(result.commits.at(-1)!.message, "commit-9");
  assert.equal(result.comments[0]!.body, "Conversation context");
  assert.equal(result.reviews[0]!.body, "Review summary");
  assert.equal(result.reviewComments[0]!.body, "Inline compatibility concern");
});

function evidence(number: number, commitMessage: string, commentBody: string): PullRequestEvidence {
  return {
    number,
    commits: [{ sha: `${number}-sha`, message: commitMessage, author: "contributor" }],
    comments: [{ author: "maintainer", body: commentBody, createdAt: "2026-08-14T00:00:00Z" }],
    reviews: [
      {
        author: "reviewer",
        state: "COMMENTED",
        body: "Review context",
        submittedAt: "2026-08-14T00:00:00Z"
      }
    ],
    reviewComments: [
      {
        author: "reviewer",
        path: "src/navigation.ts",
        body: "Inline review context",
        createdAt: "2026-08-14T00:00:00Z"
      }
    ]
  };
}
