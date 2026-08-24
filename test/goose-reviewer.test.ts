import assert from "node:assert/strict";
import test from "node:test";
import { GooseReviewer } from "../src/review/gooseReviewer.js";
import type { PullRequestFile, ReviewMode } from "../src/types.js";
import type { PreviousReview } from "../src/review/cache.js";

const validReviewDecision = {
  review: [],
  change: [],
  comment: "Looks good.",
  result: {
    canMerge: true,
    summary: "Safe to merge.",
    shouldClosePullRequest: false,
    closeReason: ""
  }
};

const mockFiles: PullRequestFile[] = [
  {
    filename: "src/index.ts",
    patch: "+export const foo = 1;",
    status: "modified",
    additions: 1,
    deletions: 0
  }
];

const baseInput = {
  title: "Add foo constant",
  body: "Adds a simple constant.",
  files: mockFiles,
  mode: "normal" as ReviewMode
};

// Helper: create a GooseReviewer that records the prompt and returns a controlled value
function createReviewer(
  response: unknown = validReviewDecision,
  onPrompt?: (prompt: string) => void
): GooseReviewer {
  const promptRunner = async (prompt: string) => {
    onPrompt?.(prompt);
    const value = response;
    if (value instanceof Error) {
      throw value;
    }
    return typeof value === "function" ? value(prompt) : JSON.stringify(value);
  };
  return new GooseReviewer(promptRunner);
}

// 1. review() with valid input returns ReviewDecision
test("review() with valid input returns ReviewDecision", async () => {
  const reviewer = createReviewer();
  const decision = await reviewer.review(baseInput);

  assert.equal(decision.result.canMerge, true);
  assert.equal(decision.comment, "Looks good.");
  assert.deepEqual(decision.review, []);
  assert.deepEqual(decision.change, []);
  assert.equal(decision.result.summary, "Safe to merge.");
  assert.equal(decision.result.shouldClosePullRequest, false);
  assert.equal(decision.result.closeReason, "");
});

// 2. review() with previousReview context includes it in the prompt
test("review() with previousReview context includes it in the prompt", async () => {
  let capturedPrompt = "";
  const previousReview: PreviousReview = {
    headSha: "a".repeat(40),
    reviewedAt: "2026-08-13T00:00:00.000Z",
    decision: validReviewDecision
  };

  const reviewer = createReviewer(validReviewDecision, (p) => {
    capturedPrompt = p;
  });
  await reviewer.review({ ...baseInput, previousReview });

  assert.ok(capturedPrompt.includes("Previous review context"));
  assert.ok(capturedPrompt.includes(previousReview.headSha));
  assert.ok(capturedPrompt.includes("Re-evaluate every previous finding"));
});

// 3. review() with repositoryKnowledge includes it in the prompt
test("review() with repositoryKnowledge includes it in the prompt", async () => {
  let capturedPrompt = "";
  const knowledge = "This repository uses React 18 and follows atomic design principles.";

  const reviewer = createReviewer(validReviewDecision, (p) => {
    capturedPrompt = p;
  });
  await reviewer.review({ ...baseInput, repositoryKnowledge: knowledge });

  assert.ok(capturedPrompt.includes("repository-scoped private object storage"));
  assert.ok(capturedPrompt.includes(knowledge));
  assert.ok(capturedPrompt.includes("Trusted repository knowledge"));
});

// 4. review() with strict mode uses strict prompt
test("review() with strict mode captures the strict review instructions", async () => {
  let capturedPrompt = "";

  const reviewer = createReviewer(validReviewDecision, (p) => {
    capturedPrompt = p;
  });
  await reviewer.review({ ...baseInput, mode: "strict" });

  assert.ok(capturedPrompt.includes("strict review explicitly requested"));
  assert.ok(capturedPrompt.includes("This is a strict review"));
});

// 5. buildPrompt() output contains PR title and files
test("review() prompt contains PR title and file metadata", async () => {
  let capturedPrompt = "";
  const reviewer = createReviewer(validReviewDecision, (p) => {
    capturedPrompt = p;
  });
  await reviewer.review(baseInput);

  assert.ok(capturedPrompt.includes("Add foo constant"));
  assert.ok(capturedPrompt.includes("src/index.ts"));
  assert.ok(capturedPrompt.includes("+export const foo = 1;"));
  assert.ok(capturedPrompt.includes("modified"));
  assert.ok(capturedPrompt.includes("Pull request payload"));
});

// 6. buildPrompt() contains output contract instructions
test("review() prompt contains output contract instructions", async () => {
  let capturedPrompt = "";
  const reviewer = createReviewer(validReviewDecision, (p) => {
    capturedPrompt = p;
  });
  await reviewer.review(baseInput);

  assert.ok(capturedPrompt.includes("four top-level keys"));
  assert.ok(capturedPrompt.includes("review, change, comment, result"));
  assert.ok(capturedPrompt.includes("path, line, title, body"));
  assert.ok(capturedPrompt.includes("canMerge, summary, shouldClosePullRequest, closeReason"));
  assert.ok(capturedPrompt.includes("only one valid JSON object"));
});

// 7. buildPrompt() with previousReview contains previous review JSON
test("review() prompt with previousReview contains serialized previous review", async () => {
  let capturedPrompt = "";
  const previousReview: PreviousReview = {
    headSha: "abc123def456".repeat(4),
    reviewedAt: "2026-08-13T00:00:00.000Z",
    decision: validReviewDecision
  };

  const reviewer = createReviewer(validReviewDecision, (p) => {
    capturedPrompt = p;
  });
  await reviewer.review({ ...baseInput, previousReview });

  assert.ok(capturedPrompt.includes(previousReview.headSha));
  assert.ok(capturedPrompt.includes(previousReview.reviewedAt));
  assert.ok(capturedPrompt.includes("Previous review context"));
});

// 8. System prompt for normal mode is not strict
test("normal mode prompt does not contain strict review text", async () => {
  let capturedPrompt = "";
  const reviewer = createReviewer(validReviewDecision, (p) => {
    capturedPrompt = p;
  });
  await reviewer.review(baseInput);

  assert.ok(capturedPrompt.includes("normal review"));
  assert.ok(capturedPrompt.includes("Do not nitpick or pursue minor details"));
  assert.ok(!capturedPrompt.includes("strict review"));
});

// 9. System prompt for strict mode includes "strict review"
test("strict mode prompt includes strict review admonition", async () => {
  let capturedPrompt = "";
  const reviewer = createReviewer(validReviewDecision, (p) => {
    capturedPrompt = p;
  });
  await reviewer.review({ ...baseInput, mode: "strict" });

  assert.ok(
    capturedPrompt.includes("strict review explicitly requested by the repository administrators")
  );
  assert.ok(!capturedPrompt.includes("Do not nitpick or pursue minor details"));
});

// 10. Schema validation: invalid JSON from goose throws
test("invalid JSON from goose throws a non-retryable error", async () => {
  const reviewer = createReviewer(() => "not valid json {{{");
  await assert.rejects(
    () => reviewer.review(baseInput),
    /Unexpected token|not valid JSON|JSON\.parse|SyntaxError/
  );
});

// 11. Schema validation: missing required fields throws
test("missing required fields in goose output throws a Zod validation error", async () => {
  const reviewer = createReviewer({ incomplete: true });
  await assert.rejects(() => reviewer.review(baseInput), /review|Required|change|comment|result/);
});
