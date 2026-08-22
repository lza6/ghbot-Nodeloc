import assert from "node:assert/strict";
import test from "node:test";
import { compactFilesForReview } from "../src/review/prompt.js";

function file(name: string, patch?: string) {
  return { filename: name, patch, status: "modified", additions: 1, deletions: 0 };
}

test("patches within the budget pass through untouched", () => {
  const files = [file("a.ts", "abc"), file("b.ts", "de")];
  const result = compactFilesForReview(files, 10);
  assert.deepEqual(
    result.map((item) => item.patch),
    ["abc", "de"]
  );
});

test("the last file is truncated when the budget runs out mid-list", () => {
  const files = [file("a.ts", "abcdef"), file("b.ts", "ghijkl")];
  const result = compactFilesForReview(files, 8);
  assert.equal(result[0]?.patch, "abcdef");
  assert.equal(result[1]?.patch, "gh\n[patch truncated]");
});

test("files after exhaustion lose their patch but keep metadata (D-10)", () => {
  const files = [file("a.ts", "0123456789"), file("b.ts", "extra"), file("c.ts", "more")];
  const result = compactFilesForReview(files, 5);
  assert.equal(result[0]?.patch, "01234\n[patch truncated]");
  assert.equal(result[1]?.patch, undefined);
  assert.equal(result[2]?.patch, undefined);
  assert.equal(result[2]?.filename, "c.ts");
});

test("empty patches are dropped (falsy) and never consume budget", () => {
  const files = [file("a.ts", ""), file("b.ts", "xy")];
  const result = compactFilesForReview(files, 5);
  assert.equal(result[0]?.patch, undefined);
  assert.equal(result[1]?.patch, "xy");
});
