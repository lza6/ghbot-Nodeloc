import assert from "node:assert/strict";
import test from "node:test";
import { collectValidNewLines, toDiffPosition } from "../src/github/diff.js";

function file(patch?: string) {
  return { filename: "src/a.ts", patch, status: "modified", additions: 2, deletions: 1 };
}

const samplePatch = [
  "@@ -1,3 +1,4 @@",
  " context line",
  "-removed line",
  "+added line one",
  "+added line two",
  " more context"
].join("\n");

test("collectValidNewLines tracks added lines per file", () => {
  const valid = collectValidNewLines([file(samplePatch)]);
  assert.equal(valid.has("src/a.ts:2"), true);
  assert.equal(valid.has("src/a.ts:3"), true);
  assert.equal(valid.has("src/a.ts:1"), false);
  assert.equal(valid.has("src/a.ts:4"), false);
});

test("files without patches contribute no valid lines", () => {
  const valid = collectValidNewLines([file(undefined)]);
  assert.equal(valid.size, 0);
});

test("toDiffPosition maps valid new lines and rejects stale ones", () => {
  const valid = collectValidNewLines([file(samplePatch)]);
  assert.deepEqual(toDiffPosition(file(), 2, valid), {
    path: "src/a.ts",
    line: 2,
    side: "RIGHT"
  });
  assert.equal(toDiffPosition(file(), 99, valid), null);
});

test("hunk headers with ranges are parsed correctly", () => {
  const valid = collectValidNewLines([file("@@ -10,5 +20,3 @@\n+first\n+second\n+third")]);
  assert.equal(valid.has("src/a.ts:20"), true);
  assert.equal(valid.has("src/a.ts:22"), true);
  assert.equal(valid.has("src/a.ts:23"), false);
});
