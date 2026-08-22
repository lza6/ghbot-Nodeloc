import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReviewDecision } from "../src/review/normalize.js";

function finding(path: string, line: number) {
  return { path, line, title: "t", body: "b" };
}

const baseResult = {
  canMerge: true,
  summary: "s",
  shouldClosePullRequest: false,
  closeReason: ""
};

test("keeps findings whose paths exist and lines are positive integers", () => {
  const decision = {
    review: [finding("src/a.ts", 3)],
    change: [finding("src/b.ts", 1)],
    comment: "c",
    result: { ...baseResult }
  };
  const normalized = normalizeReviewDecision(decision, ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(normalized.decision.review, decision.review);
  assert.deepEqual(normalized.decision.change, decision.change);
  assert.deepEqual(normalized.warnings, []);
});

test("moves findings with unknown paths or bad lines into warnings", () => {
  const decision = {
    review: [finding("ghost.ts", 2), finding("src/a.ts", -1), finding("src/a.ts", 0)],
    change: [],
    comment: "c",
    result: { ...baseResult }
  };
  const normalized = normalizeReviewDecision(decision, ["src/a.ts"]);
  assert.equal(normalized.decision.review.length, 0);
  assert.equal(normalized.warnings.length, 3);
  assert.match(normalized.warnings[0] ?? "", /unknown file/);
  assert.match(normalized.warnings[1] ?? "", /invalid line/);
});

test("a non-empty change list forces canMerge=false conservatively", () => {
  const decision = {
    review: [],
    change: [finding("src/a.ts", 1)],
    comment: "c",
    result: { ...baseResult, canMerge: true }
  };
  const normalized = normalizeReviewDecision(decision, ["src/a.ts"]);
  assert.equal(normalized.decision.result.canMerge, false);
});

test("shouldClosePullRequest=true forces a non-empty closeReason requirement warning-free pass", () => {
  const decision = {
    review: [],
    change: [],
    comment: "c",
    result: { ...baseResult, shouldClosePullRequest: true, closeReason: "backdoor" }
  };
  const normalized = normalizeReviewDecision(decision, []);
  assert.equal(normalized.decision.result.shouldClosePullRequest, true);
  assert.equal(normalized.warnings.length, 0);
});
