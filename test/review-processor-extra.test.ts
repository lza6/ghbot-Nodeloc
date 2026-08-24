import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewSubmissionPlan,
  formatSupersededReviewBody,
  isConflictComment,
  isRecheckComment,
  shortSha,
  shouldFallbackToCommentReview
} from "../src/review/processor.js";
import type { ReviewDecision } from "../src/types.js";

type DispositionEvent = "APPROVE" | "COMMENT" | "REQUEST_CHANGES";

const cleanDecision: ReviewDecision = {
  review: [],
  change: [],
  comment: "looks fine",
  result: { canMerge: true, summary: "approved", shouldClosePullRequest: false, closeReason: "" }
};

function finding(path: string, line: number, title: string, body: string) {
  return { path, line, title, body };
}

test("buildReviewSubmissionPlan emits REQUEST_CHANGES first when change findings exist", () => {
  const decision: ReviewDecision = {
    ...cleanDecision,
    change: [finding("a.ts", 1, "change it", "blocking")]
  };
  const plan = buildReviewSubmissionPlan(decision, { event: "APPROVE" });

  assert.equal(plan[0]?.phase, "change");
  assert.equal(plan[0]?.event, "REQUEST_CHANGES");
  assert.equal(plan[0]?.findings.length, 1);
  assert.equal(plan[0]?.findings[0]?.category, "change");
});

test("buildReviewSubmissionPlan emits a COMMENT phase for review findings", () => {
  const decision: ReviewDecision = {
    ...cleanDecision,
    review: [finding("b.ts", 2, "note", "non-blocking")]
  };
  const plan = buildReviewSubmissionPlan(decision, { event: "APPROVE" });

  assert.equal(plan[0]?.phase, "review");
  assert.equal(plan[0]?.event, "COMMENT");
  assert.equal(plan[0]?.findings.length, 1);
  assert.equal(plan[0]?.findings[0]?.category, "review");
});

test("buildReviewSubmissionPlan orders change before review when both exist", () => {
  const decision: ReviewDecision = {
    ...cleanDecision,
    change: [finding("a.ts", 1, "change it", "blocking")],
    review: [finding("b.ts", 2, "note", "non-blocking")]
  };
  const plan = buildReviewSubmissionPlan(decision, { event: "APPROVE" });

  assert.deepEqual(
    plan.map((phase) => phase.phase),
    ["change", "review", "final"]
  );
  assert.deepEqual(
    plan.map((phase) => phase.event),
    ["REQUEST_CHANGES", "COMMENT", "COMMENT"]
  );
});

test("buildReviewSubmissionPlan emits final APPROVE when there are no findings", () => {
  const plan = buildReviewSubmissionPlan(cleanDecision, { event: "APPROVE" });

  assert.equal(plan.length, 1);
  assert.equal(plan[0]?.phase, "final");
  assert.equal(plan[0]?.event, "APPROVE");
  assert.deepEqual(plan[0]?.findings, []);
});

test("buildReviewSubmissionPlan always ends with a final phase", () => {
  const withChangeOnly: ReviewDecision = {
    ...cleanDecision,
    change: [finding("a.ts", 1, "change it", "blocking")]
  };
  const withReviewOnly: ReviewDecision = {
    ...cleanDecision,
    review: [finding("b.ts", 2, "note", "non-blocking")]
  };
  const both: ReviewDecision = {
    ...cleanDecision,
    change: [finding("a.ts", 1, "change it", "blocking")],
    review: [finding("b.ts", 2, "note", "non-blocking")]
  };

  for (const [label, decision, event] of [
    ["clean", cleanDecision, "APPROVE" as DispositionEvent],
    ["change only", withChangeOnly, "REQUEST_CHANGES" as DispositionEvent],
    ["review only", withReviewOnly, "COMMENT" as DispositionEvent],
    ["both", both, "REQUEST_CHANGES" as DispositionEvent]
  ]) {
    const plan = buildReviewSubmissionPlan(decision, { event });
    const last = plan.at(-1);
    assert.equal(last?.phase, "final", `${label}: last phase must be final`);
    assert.deepEqual(last?.findings ?? [], [], `${label}: final phase carries no findings`);
  }
});

test("buildReviewSubmissionPlan forces final event to COMMENT when change findings exist", () => {
  const withChangeOnly: ReviewDecision = {
    ...cleanDecision,
    change: [finding("a.ts", 1, "change it", "blocking")]
  };
  const withChangeThenReview: ReviewDecision = {
    ...cleanDecision,
    change: [finding("a.ts", 1, "change it", "blocking")],
    review: [finding("b.ts", 2, "note", "non-blocking")]
  };

  const changePlan = buildReviewSubmissionPlan(withChangeOnly, { event: "REQUEST_CHANGES" });
  assert.equal(changePlan.at(-1)?.event, "COMMENT");

  const bothPlan = buildReviewSubmissionPlan(withChangeThenReview, { event: "REQUEST_CHANGES" });
  assert.equal(bothPlan.at(-1)?.event, "COMMENT");
});

test("buildReviewSubmissionPlan leaves final event to the disposition when no change findings exist", () => {
  const withReviewOnly: ReviewDecision = {
    ...cleanDecision,
    review: [finding("b.ts", 2, "note", "non-blocking")]
  };

  const plan = buildReviewSubmissionPlan(withReviewOnly, { event: "APPROVE" });
  assert.equal(plan.at(-1)?.event, "APPROVE");
});

test("shouldFallbackToCommentReview returns false for non-APPROVE events", () => {
  const error = {
    status: 422,
    message: "GitHub Actions is not permitted to approve pull requests."
  };
  assert.equal(shouldFallbackToCommentReview(error, "COMMENT"), false);
  assert.equal(shouldFallbackToCommentReview(error, "REQUEST_CHANGES"), false);
});

test("shouldFallbackToCommentReview returns false for non-422 errors", () => {
  const error = {
    status: 403,
    message: "GitHub Actions is not permitted to approve pull requests."
  };
  assert.equal(shouldFallbackToCommentReview(error, "APPROVE"), false);
});

test("shouldFallbackToCommentReview returns true for 422 with GitHub Actions not permitted", () => {
  const error = {
    status: 422,
    message: "GitHub Actions is not permitted to approve pull requests."
  };
  assert.equal(shouldFallbackToCommentReview(error, "APPROVE"), true);
});

test("shouldFallbackToCommentReview returns false for 422 with unrelated message", () => {
  const error = { status: 422, message: "Validation error: body is too long." };
  assert.equal(shouldFallbackToCommentReview(error, "APPROVE"), false);
});

test("shouldFallbackToCommentReview returns false for non-object errors", () => {
  assert.equal(shouldFallbackToCommentReview("string error", "APPROVE"), false);
  assert.equal(shouldFallbackToCommentReview(null, "APPROVE"), false);
  assert.equal(shouldFallbackToCommentReview(undefined, "APPROVE"), false);
});

test("shortSha returns first 12 characters", () => {
  const sha = "abcdef0123456789abcdef0123456789abcdef01";
  assert.equal(shortSha(sha), "abcdef012345");
  assert.equal(shortSha(sha).length, 12);
});

test("isRecheckComment matches the exact command", () => {
  assert.equal(isRecheckComment("/recheck"), true);
});

test("isRecheckComment matches with surrounding whitespace", () => {
  assert.equal(isRecheckComment("  /recheck  "), true);
  assert.equal(isRecheckComment("\t/recheck\n"), true);
});

test("isRecheckComment rejects different text", () => {
  assert.equal(isRecheckComment("please recheck"), false);
  assert.equal(isRecheckComment("/refresh"), false);
  assert.equal(isRecheckComment(""), false);
});

test("isConflictComment matches the exact command", () => {
  assert.equal(isConflictComment("/conflict"), true);
});

test("isConflictComment matches with surrounding whitespace", () => {
  assert.equal(isConflictComment("  /conflict  "), true);
  assert.equal(isConflictComment("\t/conflict\n"), true);
});

test("isConflictComment rejects different text", () => {
  assert.equal(isConflictComment("resolve conflict"), false);
  assert.equal(isConflictComment("/conflicts"), false);
  assert.equal(isConflictComment(""), false);
});

test("formatSupersededReviewBody keeps the original state marker", () => {
  const originalMarker =
    "<!-- ghbot-review:v1 mode=normal outcome=pass requires-admin=false review=1 change=0 -->";
  const body = formatSupersededReviewBody({
    originalMarker,
    oldCommitId: "a".repeat(40),
    currentCommitId: "b".repeat(40)
  });

  assert.ok(body.startsWith(originalMarker), "body must start with the original marker line");
});

test("formatSupersededReviewBody includes old and new commit SHAs (short form)", () => {
  const oldCommitId = "a".repeat(40);
  const currentCommitId = "b".repeat(40);
  const body = formatSupersededReviewBody({
    originalMarker: "<!-- ghbot-review:v1 superseded=true -->",
    oldCommitId,
    currentCommitId
  });

  assert.ok(body.includes(oldCommitId.slice(0, 12)), "body must mention the old short SHA");
  assert.ok(body.includes(currentCommitId.slice(0, 12)), "body must mention the new short SHA");
  assert.equal(body.includes(oldCommitId), false, "full old SHA should not be used");
  assert.equal(body.includes(currentCommitId), false, "full current SHA should not be used");
});

test("formatSupersededReviewBody marks the review as Superseded", () => {
  const body = formatSupersededReviewBody({
    originalMarker: "<!-- ghbot-review:v1 superseded=true -->",
    oldCommitId: "a".repeat(40),
    currentCommitId: "b".repeat(40)
  });

  assert.match(body, /## Superseded automated review/);
  assert.match(body, /Superseded automated review/);
});
