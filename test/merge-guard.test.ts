import assert from "node:assert/strict";
import test from "node:test";
import { MergeGuard } from "../src/review/merge-guard.js";

test("markAttempt followed by isAlreadyAttempted returns true", () => {
  const guard = new MergeGuard();
  guard.markAttempt("owner1", "repo1", 42);
  assert.equal(guard.isAlreadyAttempted("owner1", "repo1", 42), true);
});

test("isAlreadyAttempted returns false for a never-attempted PR", () => {
  const guard = new MergeGuard();
  assert.equal(guard.isAlreadyAttempted("owner1", "repo1", 99), false);
});

test("getRecentAttempts returns list of attempted PR keys", () => {
  const guard = new MergeGuard();
  guard.markAttempt("a", "repo-a", 1);
  guard.markAttempt("b", "repo-b", 2);
  const attempts = guard.getRecentAttempts();
  assert.equal(attempts.length, 2);
  assert.ok(attempts.includes("a/repo-a#1"));
  assert.ok(attempts.includes("b/repo-b#2"));
});

test("multiple attempts on the same PR increment count", () => {
  const guard = new MergeGuard();
  guard.markAttempt("same", "pr", 1);
  guard.markAttempt("same", "pr", 1);
  guard.markAttempt("same", "pr", 1);
  assert.equal(guard.getAttemptedCount(), 3);
  assert.equal(guard.isAlreadyAttempted("same", "pr", 1), true);
});

test("different PRs are tracked independently", () => {
  const guard = new MergeGuard();
  guard.markAttempt("owner1", "repo1", 10);
  guard.markAttempt("owner2", "repo2", 20);

  assert.equal(guard.isAlreadyAttempted("owner1", "repo1", 10), true);
  assert.equal(guard.isAlreadyAttempted("owner1", "repo1", 11), false);
  assert.equal(guard.isAlreadyAttempted("owner2", "repo2", 20), true);
  assert.equal(guard.isAlreadyAttempted("owner2", "repo2", 21), false);

  assert.equal(guard.getAttemptedCount(), 2);
});
