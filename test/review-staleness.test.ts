import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReviewStaleness } from "../src/review/staleness.js";
import type { PullRequestFile } from "../src/types.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function file(filename: string, patch: string): PullRequestFile {
  return { filename, patch, status: "modified", additions: 0, deletions: 0 };
}

test("returns unchanged when heads match", () => {
  const result = evaluateReviewStaleness({
    beforeFiles: [file("a.ts", "+1")],
    afterFiles: [file("a.ts", "+1")],
    oldHeadSha: SHA_A,
    newHeadSha: SHA_A,
    maxPatchChars: 1000
  });
  assert.deepEqual(result, { action: "unchanged" });
});

test("returns discard when an existing file's patch changed", () => {
  const result = evaluateReviewStaleness({
    beforeFiles: [file("a.ts", "+1")],
    afterFiles: [file("a.ts", "+changed")],
    oldHeadSha: SHA_A,
    newHeadSha: SHA_B,
    maxPatchChars: 1000
  });
  assert.deepEqual(result, { action: "discard" });
});

test("returns discard when delta exceeds half the max patch", () => {
  const big = "+".repeat(600);
  const result = evaluateReviewStaleness({
    beforeFiles: [file("a.ts", "+1")],
    afterFiles: [file("a.ts", "+1"), file("big.ts", big)],
    oldHeadSha: SHA_A,
    newHeadSha: SHA_B,
    maxPatchChars: 1000
  });
  assert.deepEqual(result, { action: "discard" });
});

test("returns append when only small additive files were added", () => {
  const result = evaluateReviewStaleness({
    beforeFiles: [file("a.ts", "+1")],
    afterFiles: [file("a.ts", "+1"), file("b.ts", "+2")],
    oldHeadSha: SHA_A,
    newHeadSha: SHA_B,
    maxPatchChars: 1000
  });
  assert.equal(result.action, "append");
  if (result.action === "append") {
    assert.ok(result.additionalPrompt.includes("b.ts"));
    assert.ok(result.additionalPrompt.includes("+2"));
    assert.ok(!result.additionalPrompt.includes("a.ts"));
  }
});

test("returns discard when added files have no patch content", () => {
  const result = evaluateReviewStaleness({
    beforeFiles: [file("a.ts", "+1")],
    afterFiles: [file("a.ts", "+1"), file("empty.ts", "")],
    oldHeadSha: SHA_A,
    newHeadSha: SHA_B,
    maxPatchChars: 1000
  });
  assert.deepEqual(result, { action: "discard" });
});
