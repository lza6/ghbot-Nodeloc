import assert from "node:assert/strict";
import test from "node:test";
import { formatReviewBody, formatFindingReviewBody } from "../src/review/format.js";
import type { ReviewDecision, ReviewMode } from "../src/types.js";
import type { ReviewDisposition } from "../src/review/policy.js";

const mode: ReviewMode = "normal";

const passDisposition: ReviewDisposition = {
  event: "APPROVE",
  blocksMerge: false,
  requiresAdminApproval: false,
  outcome: "pass"
};

const blockDisposition: ReviewDisposition = {
  event: "REQUEST_CHANGES",
  blocksMerge: true,
  requiresAdminApproval: false,
  outcome: "block"
};

const adminDisposition: ReviewDisposition = {
  event: "COMMENT",
  blocksMerge: false,
  requiresAdminApproval: true,
  outcome: "pass"
};

function decision(overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    review: [],
    change: [],
    comment: "Overall this looks fine.",
    result: { canMerge: true, summary: "safe", shouldClosePullRequest: false, closeReason: "" },
    ...overrides
  };
}

test("clean pass body shows the approve summary and merge guidance", () => {
  const body = formatReviewBody(decision(), [], mode, passDisposition);
  assert.match(body, /Final status: safe to merge/);
  assert.match(body, /Model decision: safe to merge/);
  assert.match(body, /Applied review policy/);
});

test("blocked body lists unposted findings and recheck hint", () => {
  const withChange = decision({
    change: [{ path: "a.ts", line: 1, title: "Fix it", body: "broken" }],
    result: { ...decision().result, canMerge: false }
  });
  const body = formatReviewBody(
    withChange,
    [{ ...withChange.change[0]!, category: "change" as const }],
    mode,
    blockDisposition
  );
  assert.match(body, /Final status: changes requested/);
  assert.match(body, /could not be attached inline/);
  assert.match(body, /\/recheck/);
});

test("admin approval body states the waiting disposition", () => {
  const body = formatReviewBody(decision(), [], mode, adminDisposition);
  assert.match(body, /waiting for repository administrator approval/);
});

test("finding bodies carry the state marker and finding count", () => {
  const withReview = decision({
    review: [{ path: "b.ts", line: 2, title: "note", body: "nb" }]
  });
  const body = formatFindingReviewBody(withReview, "review", [], mode, passDisposition);
  assert.match(body, /<!-- ghbot-review:v1/);
  assert.match(body, /Findings: 1/);
});
