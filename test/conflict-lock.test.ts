import assert from "node:assert/strict";
import test from "node:test";
import { acquireConflictLock } from "../src/review/conflictResolver.js";

test("conflict lock rejects overlapping runs for the same pull request", async () => {
  const release = await acquireConflictLock("acme/demo#7");
  await assert.rejects(() => acquireConflictLock("acme/demo#7"), /already active/);
  release();
  const releaseAgain = await acquireConflictLock("acme/demo#7");
  releaseAgain();
});

test("conflict lock allows concurrent runs for different pull requests", async () => {
  const first = await acquireConflictLock("acme/demo#8");
  const second = await acquireConflictLock("acme/demo#9");
  first();
  second();
});
