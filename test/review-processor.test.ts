import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewSubmissionPlan,
  isConflictComment,
  isRecheckComment,
  formatSupersededReviewBody
} from "../src/review/processor.js";
import type { ReviewDecision } from "../src/types.js";

const cleanDecision: ReviewDecision = {
  review: [],
  change: [],
  comment: "ok",
  result: { canMerge: true, summary: "s", shouldClosePullRequest: false, closeReason: "" }
};

test("recheck and conflict commands match only exact bodies", () => {
  assert.equal(isRecheckComment("/recheck"), true);
  assert.equal(isRecheckComment("  /recheck  "), true);
  assert.equal(isRecheckComment("please /recheck now"), false);
  assert.equal(isRecheckComment("/recheck extra"), false);
  assert.equal(isConflictComment("/conflict"), true);
  assert.equal(isConflictComment("/conflict?"), false);
});

test("submission plan emits change phase first, then review, then final", () => {
  const decision: ReviewDecision = {
    review: [{ path: "a.ts", line: 1, title: "r", body: "b" }],
    change: [{ path: "b.ts", line: 2, title: "c", body: "b" }],
    comment: "c",
    result: { ...cleanDecision.result }
  };
  const approveDisposition = { event: "APPROVE" as const };
  const plan = buildReviewSubmissionPlan(decision, approveDisposition);
  assert.deepEqual(
    plan.map((phase) => [phase.phase, phase.event]),
    [
      ["change", "REQUEST_CHANGES"],
      ["review", "COMMENT"],
      ["final", "COMMENT"]
    ]
  );
  assert.equal(plan[0]?.findings.length, 1);
  assert.equal(plan[1]?.findings.length, 1);
  assert.equal(plan[2]?.findings.length, 0);
});

test("a clean decision submits a single final APPROVE review", () => {
  const plan = buildReviewSubmissionPlan(cleanDecision, { event: "APPROVE" });
  assert.equal(plan.length, 1);
  assert.equal(plan[0]?.phase, "final");
  assert.equal(plan[0]?.event, "APPROVE");
});

test("superseded review bodies keep the original state marker", () => {
  const marker = "<!-- ghbot-review:v1 mode=normal outcome=pass requires-admin=false review=0 change=0 -->";
  const body = formatSupersededReviewBody({
    originalMarker: marker,
    oldCommitId: "a".repeat(40),
    currentCommitId: "b".repeat(40)
  });
  assert.ok(body.startsWith(marker));
  assert.match(body, /Superseded automated review/);
});
