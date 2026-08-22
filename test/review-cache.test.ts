import assert from "node:assert/strict";
import test from "node:test";
import { parseReviewCacheContent } from "../src/review/cache.js";

test("review cache parser accepts the structured review result", () => {
  const parsed = parseReviewCacheContent(
    JSON.stringify({
      version: 1,
      repository: "forumlify/public",
      pullNumber: 17,
      headSha: "a".repeat(40),
      reviewedAt: "2026-08-13T00:00:00.000Z",
      decision: {
        review: [],
        change: [],
        comment: "Looks good.",
        result: {
          canMerge: true,
          summary: "Safe to merge.",
          shouldClosePullRequest: false,
          closeReason: ""
        }
      }
    })
  );
  assert.equal(parsed.repository, "forumlify/public");
  assert.equal(parsed.pullNumber, 17);
  assert.equal(parsed.decision.result.canMerge, true);
  assert.throws(() => parseReviewCacheContent("{}"));
});
