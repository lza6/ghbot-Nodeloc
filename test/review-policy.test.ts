import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewDecision } from "../src/types.js";
import {
  approvedLoginsForHead,
  branchPatternToRegExp,
  evaluateReviewDecision,
  formatReviewExternalId,
  formatReviewStateMarker,
  parseReviewExternalId,
  parseReviewStateMarker
} from "../src/review/policy.js";
import { config } from "../src/config.js";
import { isConflictComment, isRecheckComment } from "../src/review/processor.js";

const cleanDecision: ReviewDecision = {
  review: [],
  change: [],
  comment: "Clean",
  result: {
    canMerge: true,
    summary: "Safe",
    shouldClosePullRequest: false,
    closeReason: ""
  }
};

test("clean reviews approve under the default policy", () => {
  assert.equal(config.reviewPolicy, "allow");
  assert.equal(config.reviewStrictness, "normal");
  assert.deepEqual(evaluateReviewDecision(cleanDecision), {
    event: "APPROVE",
    blocksMerge: false,
    requiresAdminApproval: false,
    outcome: "pass"
  });
});

test("ordinary review notes approve under the default policy", () => {
  const decision = {
    ...cleanDecision,
    review: [{ path: "src/a.ts", line: 1, title: "Check this", body: "Concrete note" }]
  };
  assert.deepEqual(evaluateReviewDecision(decision), {
    event: "APPROVE",
    blocksMerge: false,
    requiresAdminApproval: false,
    outcome: "pass"
  });
});

test("allow policy approves ordinary review notes", () => {
  const decision = {
    ...cleanDecision,
    review: [{ path: "src/a.ts", line: 1, title: "Check this", body: "Concrete note" }]
  };
  assert.deepEqual(evaluateReviewDecision(decision, "allow"), {
    event: "APPROVE",
    blocksMerge: false,
    requiresAdminApproval: false,
    outcome: "pass"
  });
});

test("reject policy blocks ordinary review notes", () => {
  const decision = {
    ...cleanDecision,
    review: [{ path: "src/a.ts", line: 1, title: "Check this", body: "Concrete note" }]
  };
  assert.deepEqual(evaluateReviewDecision(decision, "reject"), {
    event: "REQUEST_CHANGES",
    blocksMerge: true,
    requiresAdminApproval: false,
    outcome: "block"
  });
});

test("required changes always block", () => {
  const decision = {
    ...cleanDecision,
    result: { ...cleanDecision.result, canMerge: false },
    change: [{ path: "src/a.ts", line: 1, title: "Broken", body: "Concrete failure" }]
  };
  assert.deepEqual(evaluateReviewDecision(decision), {
    event: "REQUEST_CHANGES",
    blocksMerge: true,
    requiresAdminApproval: false,
    outcome: "block"
  });
});

test("review state markers round trip", () => {
  const disposition = evaluateReviewDecision({
    ...cleanDecision,
    review: [{ path: "src/a.ts", line: 1, title: "Check", body: "Note" }]
  });
  assert.deepEqual(parseReviewStateMarker(formatReviewStateMarker("strict", disposition, 1, 0)), {
    mode: "strict",
    outcome: "pass",
    requiresAdminApproval: false
  });
  assert.deepEqual(parseReviewExternalId(formatReviewExternalId("normal", disposition)), {
    mode: "normal",
    outcome: "pass",
    requiresAdminApproval: false
  });
  assert.deepEqual(
    parseReviewExternalId("ghbot-review:v1:mode=lenient:outcome=pass:requires-admin=false"),
    { mode: "normal", outcome: "pass", requiresAdminApproval: false }
  );
});

test("branch glob stars respect slash boundaries", () => {
  assert.equal(branchPatternToRegExp("main").test("main"), true);
  assert.equal(branchPatternToRegExp("release/*").test("release/1.0"), true);
  assert.equal(branchPatternToRegExp("release/*").test("release/mobile/1.0"), false);
  assert.equal(branchPatternToRegExp("release/**").test("release/mobile/1.0"), true);
  assert.equal(branchPatternToRegExp("release/?.x").test("release/1.x"), true);
});

test("only the exact recheck command triggers a manual review", () => {
  assert.equal(isRecheckComment("/recheck"), true);
  assert.equal(isRecheckComment("  /recheck\n"), true);
  assert.equal(isRecheckComment("/lenient-check"), false);
  assert.equal(isRecheckComment("/recheck something"), false);
});

test("only the exact conflict command triggers manual conflict resolution", () => {
  assert.equal(isConflictComment("/conflict"), true);
  assert.equal(isConflictComment("  /conflict\n"), true);
  assert.equal(isConflictComment("/conflicts"), false);
  assert.equal(isConflictComment("/conflict now"), false);
});

test("only the latest decisive review per user can approve the current head", () => {
  assert.deepEqual(
    approvedLoginsForHead(
      [
        {
          id: 1,
          state: "APPROVED",
          commitId: "head",
          login: "alice",
          submittedAt: "2026-08-13T01:00:00Z"
        },
        {
          id: 2,
          state: "COMMENTED",
          commitId: "head",
          login: "alice",
          submittedAt: "2026-08-13T02:00:00Z"
        },
        {
          id: 3,
          state: "APPROVED",
          commitId: "old-head",
          login: "bob",
          submittedAt: "2026-08-13T03:00:00Z"
        },
        {
          id: 4,
          state: "APPROVED",
          commitId: "head",
          login: "carol",
          submittedAt: "2026-08-13T04:00:00Z"
        },
        {
          id: 5,
          state: "CHANGES_REQUESTED",
          commitId: "head",
          login: "carol",
          submittedAt: "2026-08-13T05:00:00Z"
        }
      ],
      "head"
    ),
    ["alice"]
  );
});
