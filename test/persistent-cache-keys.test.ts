import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeObjectPrefix,
  pullRequestReviewHistoryObjectKey,
  pullRequestReviewObjectKey,
  repositoryKnowledgeObjectKey
} from "../src/storage/cacheStore.js";

test("object keys are scoped by repository id, pull number, and optional prefix", () => {
  assert.equal(repositoryKnowledgeObjectKey("123"), "repositories/123/knowledge/repository.md");
  assert.equal(pullRequestReviewObjectKey("123", 7), "repositories/123/pulls/7/latest.json");
  assert.equal(
    pullRequestReviewObjectKey("123", 7, "forum-1"),
    "forum-1/repositories/123/pulls/7/latest.json"
  );
});

test("history keys pin the reviewed head sha in lowercase hex form", () => {
  const sha = "A".repeat(40).toLowerCase();
  assert.equal(
    pullRequestReviewHistoryObjectKey("123", 9, sha.toUpperCase()),
    `repositories/123/pulls/9/reviews/${sha}.json`
  );
  assert.throws(() => pullRequestReviewHistoryObjectKey("123", 9, "short"), /40-64 hexadecimal/);
  assert.throws(
    () => pullRequestReviewHistoryObjectKey("123", -1, sha),
    /Pull request number must be a positive integer/
  );
});

test("normalizeObjectPrefix validates each slash-separated segment", () => {
  assert.equal(normalizeObjectPrefix(undefined), "");
  assert.equal(normalizeObjectPrefix(""), "");
  assert.equal(normalizeObjectPrefix("/a/b/"), "a/b");
  assert.throws(() => normalizeObjectPrefix("bad/../segment"), /safe slash-separated/);
  assert.throws(() => normalizeObjectPrefix(".hidden"), /safe slash-separated/);
});
