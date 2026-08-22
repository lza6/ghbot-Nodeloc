import assert from "node:assert/strict";
import test from "node:test";
import {
  parseFinalConfirmation,
  describeConflictResolutionFailure
} from "../src/review/conflictResolver.js";

test("final confirmation parses a clean JSON body", () => {
  const parsed = parseFinalConfirmation(
    JSON.stringify({ safeToCommit: true, summary: "ok", concerns: [] })
  );
  assert.equal(parsed.safeToCommit, true);
  assert.deepEqual(parsed.concerns, []);
});

test("final confirmation tolerates surrounding prose around the JSON", () => {
  const parsed = parseFinalConfirmation(
    `Here is my assessment:\n${JSON.stringify({
      safeToCommit: false,
      summary: "unsafe",
      concerns: ["a", "b"]
    })}\nDone.`
  );
  assert.equal(parsed.safeToCommit, false);
  assert.deepEqual(parsed.concerns, ["a", "b"]);
});

test("final confirmation rejects structurally invalid output", () => {
  assert.throws(() => parseFinalConfirmation("no json here"), /did not return the required JSON/);
  assert.throws(
    () => parseFinalConfirmation(JSON.stringify({ safeToCommit: "yes" })),
    /did not return the required JSON/
  );
});

test("failure descriptions are actionable and never expose raw command output", () => {
  const timeout = describeConflictResolutionFailure(
    new Error("initial goose conflict-editing pass timed out.")
  );
  assert.match(timeout, /No commit was pushed/);
  const identity = describeConflictResolutionFailure(new Error("committer identity unknown"));
  assert.match(identity, /committer identity/);
  const push = describeConflictResolutionFailure(new Error("! [rejected] ... (stale info)"));
  assert.match(push, /force lease rejected|Run \/conflict again/);
  const generic = describeConflictResolutionFailure(new Error("something odd"));
  assert.match(generic, /could not safely complete/);
  const validation = describeConflictResolutionFailure(
    new Error("Validation command failed after goose correction: exit 1")
  );
  assert.match(validation, /validation or final safety confirmation rejected/);
});
