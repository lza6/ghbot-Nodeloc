import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireConflictLock,
  canAutoResolveConflicts,
  describeConflictResolutionFailure
} from "../src/review/conflictResolver.js";

const eligible = {
  enabled: true,
  reviewPassed: true,
  mergeable: false,
  mergeableState: "dirty",
  baseRepository: "forumlify/public",
  headRepository: "forumlify/public",
  maintainerCanModify: false,
  expectedHeadSha: "abc",
  currentHeadSha: "abc"
} as const;

// ---------------------------------------------------------------------------
// canAutoResolveConflicts — remaining condition combinations
// ---------------------------------------------------------------------------

test("canAutoResolveConflicts: enabled=false returns false", () => {
  assert.equal(canAutoResolveConflicts({ ...eligible, enabled: false }), false);
});

test("canAutoResolveConflicts: reviewPassed=false returns false", () => {
  assert.equal(canAutoResolveConflicts({ ...eligible, reviewPassed: false }), false);
});

test("canAutoResolveConflicts: mergeable=null returns false", () => {
  assert.equal(canAutoResolveConflicts({ ...eligible, mergeable: null }), false);
});

test("canAutoResolveConflicts: mergeable=true (non-dirty) returns false", () => {
  assert.equal(
    canAutoResolveConflicts({ ...eligible, mergeable: true, mergeableState: "clean" }),
    false
  );
});

test("canAutoResolveConflicts: mergeableState is not 'dirty' returns false", () => {
  assert.equal(canAutoResolveConflicts({ ...eligible, mergeableState: "clean" }), false);
  assert.equal(canAutoResolveConflicts({ ...eligible, mergeableState: "blocked" }), false);
  assert.equal(canAutoResolveConflicts({ ...eligible, mergeableState: "unknown" }), false);
  assert.equal(canAutoResolveConflicts({ ...eligible, mergeableState: "behind" }), false);
});

test("canAutoResolveConflicts: headRepository=null returns false", () => {
  assert.equal(canAutoResolveConflicts({ ...eligible, headRepository: null }), false);
});

test("canAutoResolveConflicts: fork without maintainerCanModify returns false", () => {
  assert.equal(
    canAutoResolveConflicts({
      ...eligible,
      headRepository: "contributor/forumlify",
      maintainerCanModify: false
    }),
    false
  );
});

test("canAutoResolveConflicts: fork with maintainerCanModify returns true", () => {
  assert.equal(
    canAutoResolveConflicts({
      ...eligible,
      headRepository: "contributor/forumlify",
      maintainerCanModify: true
    }),
    true
  );
});

test("canAutoResolveConflicts: headSha mismatch returns false", () => {
  assert.equal(canAutoResolveConflicts({ ...eligible, currentHeadSha: "different-sha" }), false);
});

test("canAutoResolveConflicts: all conditions met returns true", () => {
  assert.equal(canAutoResolveConflicts(eligible), true);
});

// ---------------------------------------------------------------------------
// acquireConflictLock — lock acquisition, duplicate rejection, release
// ---------------------------------------------------------------------------

test("acquireConflictLock: acquires a lock", async () => {
  const release = await acquireConflictLock("test/lock-single");
  assert.equal(typeof release, "function");
  release();
});

test("acquireConflictLock: throws for duplicate lock", async () => {
  const release = await acquireConflictLock("test/lock-duplicate");
  await assert.rejects(
    () => acquireConflictLock("test/lock-duplicate"),
    /already active for this pull request/
  );
  release();
});

test("acquireConflictLock: release function works and allows re-acquisition", async () => {
  const release = await acquireConflictLock("test/lock-reacquire");
  release();
  const releaseAgain = await acquireConflictLock("test/lock-reacquire");
  releaseAgain();
});

test("acquireConflictLock: concurrent keys do not interfere", async () => {
  const releaseA = await acquireConflictLock("test/lock-concurrent-a");
  const releaseB = await acquireConflictLock("test/lock-concurrent-b");
  releaseA();
  releaseB();
});

test("acquireConflictLock: double release does not throw", async () => {
  const release = await acquireConflictLock("test/lock-double-release");
  release();
  release();
});

// ---------------------------------------------------------------------------
// describeConflictResolutionFailure — remaining error types
// ---------------------------------------------------------------------------

test("describeConflictResolutionFailure: shallow git history", () => {
  const msg = describeConflictResolutionFailure(
    new Error("fatal: refusing to merge unrelated histories (shallow)")
  );
  assert.match(msg, /did not contain enough Git history/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: authentication failed", () => {
  const msg = describeConflictResolutionFailure(new Error("remote: authentication failed"));
  assert.match(msg, /Allow edits from maintainers/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: write access to repository not granted", () => {
  const msg = describeConflictResolutionFailure(
    new Error("remote: Write access to repository not granted: contributor/forumlify")
  );
  assert.match(msg, /Allow edits from maintainers/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: permission denied", () => {
  const msg = describeConflictResolutionFailure(
    new Error("remote: Permission denied to fork repository")
  );
  assert.match(msg, /Allow edits from maintainers/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: status code 403", () => {
  const msg = describeConflictResolutionFailure(new Error("HTTP status code: 403 forbidden"));
  assert.match(msg, /Allow edits from maintainers/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: non-fast-forward push", () => {
  const msg = describeConflictResolutionFailure(
    new Error("! [rejected] HEAD -> main (non-fast-forward)")
  );
  assert.match(msg, /Run \/conflict again/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: fetch first (stale remote)", () => {
  const msg = describeConflictResolutionFailure(
    new Error("! [rejected] (stale info) - fetch first")
  );
  assert.match(msg, /Run \/conflict again/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: final goose confirmation did not return valid JSON", () => {
  const msg = describeConflictResolutionFailure(
    new Error("Final goose confirmation did not return the required JSON object.")
  );
  assert.match(msg, /invalid result/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: resolved staged diff exceeds MAX_PATCH_CHARS", () => {
  const msg = describeConflictResolutionFailure(
    new Error("Resolved staged diff contains 200000 characters, exceeding MAX_PATCH_CHARS=120000.")
  );
  assert.match(msg, /patch-size limit/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: conflict validation infrastructure failed", () => {
  const msg = describeConflictResolutionFailure(
    new Error("Conflict validation infrastructure failed: docker daemon not available")
  );
  assert.match(msg, /validation environment failed/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: isolated conflict validation timed out", () => {
  const msg = describeConflictResolutionFailure(
    new Error("isolated conflict validation timed out.")
  );
  assert.match(msg, /7-minute limit/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: generic error falls through to safe default", () => {
  const msg = describeConflictResolutionFailure(new Error("unexpected runtime error"));
  assert.match(msg, /could not safely complete/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: generic error with actor name", () => {
  const msg = describeConflictResolutionFailure(
    new Error("integration test 1 failed"),
    "custom-bot"
  );
  assert.match(msg, /^custom-bot could not safely complete/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: empty ident name", () => {
  const msg = describeConflictResolutionFailure(
    new Error("empty ident name (no email address) not allowed")
  );
  assert.match(msg, /no bot committer identity/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: non-Error input is handled", () => {
  const msg = describeConflictResolutionFailure("something went wrong");
  assert.match(msg, /could not safely complete/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: null input is handled", () => {
  const msg = describeConflictResolutionFailure(null);
  assert.match(msg, /could not safely complete/);
  assert.match(msg, /no commit was pushed/i);
});

test("describeConflictResolutionFailure: validation command failure with actor name", () => {
  const msg = describeConflictResolutionFailure(
    new Error("Validation command failed after goose correction: exit 1"),
    "test-bot"
  );
  assert.match(msg, /^test-bot produced/);
  assert.match(msg, /validation or final safety confirmation rejected/);
  assert.match(msg, /no commit was pushed/i);
});
