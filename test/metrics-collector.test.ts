import assert from "node:assert/strict";
import test from "node:test";
import { MetricsCollector, metrics } from "../src/metrics/collector.js";

test("recordReviewDuration increments count", () => {
  const mc = new MetricsCollector();
  mc.recordReviewDuration(150);
  mc.recordReviewDuration(250);
  const s = mc.snapshot();
  assert.equal(s.reviewCount, 2);
  assert.equal(s.reviewDurationTotalMs, 400);
  assert.equal(s.reviewDurationAvgMs, 200);
});

test("recordReviewResult tracks outcome counts", () => {
  const mc = new MetricsCollector();
  mc.recordReviewResult("pass");
  mc.recordReviewResult("pass");
  mc.recordReviewResult("block");
  mc.recordReviewResult("malicious");
  const s = mc.snapshot();
  const outcomes = s.reviewOutcomes as Record<string, number>;
  assert.equal(outcomes.pass, 2);
  assert.equal(outcomes.block, 1);
  assert.equal(outcomes.malicious, 1);
});

test("recordGooseCall tracks success/failure counts", () => {
  const mc = new MetricsCollector();
  mc.recordGooseCall(100, true);
  mc.recordGooseCall(200, true);
  mc.recordGooseCall(300, false);
  const s = mc.snapshot();
  assert.equal(s.gooseCallCount, 3);
  assert.equal(s.gooseCallDurationTotalMs, 600);
  assert.equal(s.gooseCallAvgMs, 200);
  assert.equal(s.gooseSuccessCount, 2);
  assert.equal(s.gooseFailureCount, 1);
});

test("recordConflictResolution tracks status counts", () => {
  const mc = new MetricsCollector();
  mc.recordConflictResolution("resolved");
  mc.recordConflictResolution("resolved");
  mc.recordConflictResolution("failed");
  mc.recordConflictResolution("skipped");
  const s = mc.snapshot();
  const conflicts = s.conflictStatuses as Record<string, number>;
  assert.equal(conflicts.resolved, 2);
  assert.equal(conflicts.failed, 1);
  assert.equal(conflicts.skipped, 1);
});

test("recordMergeAttempt tracks merge counts", () => {
  const mc = new MetricsCollector();
  mc.recordMergeAttempt("merged");
  mc.recordMergeAttempt("already_merged");
  mc.recordMergeAttempt("failed");
  const s = mc.snapshot();
  const merges = s.mergeStatuses as Record<string, number>;
  assert.equal(merges.merged, 1);
  assert.equal(merges.already_merged, 1);
  assert.equal(merges.failed, 1);
});

test("recordCacheHit tracks cache hits", () => {
  const mc = new MetricsCollector();
  mc.recordCacheHit("review");
  mc.recordCacheHit("review");
  mc.recordCacheHit("knowledge");
  const s = mc.snapshot();
  const cache = s.cacheHits as Record<string, number>;
  assert.equal(cache.review, 2);
  assert.equal(cache.knowledge, 1);
});

test("snapshot returns all metrics", () => {
  const mc = new MetricsCollector();
  mc.recordReviewDuration(500);
  mc.recordReviewResult("pass");
  mc.recordGooseCall(1000, true);
  mc.recordConflictResolution("resolved");
  mc.recordMergeAttempt("merged");
  mc.recordCacheHit("review");

  const s = mc.snapshot();
  assert.ok(typeof s.uptimeSeconds === "number");
  assert.equal(s.reviewCount, 1);
  assert.equal(s.reviewDurationTotalMs, 500);
  assert.equal(s.reviewDurationAvgMs, 500);
  assert.deepEqual(s.reviewOutcomes, { pass: 1 });
  assert.equal(s.gooseCallCount, 1);
  assert.equal(s.gooseCallDurationTotalMs, 1000);
  assert.equal(s.gooseCallAvgMs, 1000);
  assert.equal(s.gooseSuccessCount, 1);
  assert.equal(s.gooseFailureCount, 0);
  assert.deepEqual(s.conflictStatuses, { resolved: 1 });
  assert.deepEqual(s.mergeStatuses, { merged: 1 });
  assert.deepEqual(s.cacheHits, { review: 1 });
});

test("formatMarkdown generates table with headers", () => {
  const mc = new MetricsCollector();
  mc.recordReviewDuration(300);
  mc.recordReviewResult("pass");
  mc.recordGooseCall(500, true);
  mc.recordConflictResolution("resolved");
  mc.recordMergeAttempt("merged");
  mc.recordCacheHit("review");

  const md = mc.formatMarkdown();
  assert.match(md, /## Metrics Summary/);
  assert.match(md, /\| Metric \| Value \|/);
  assert.match(md, /\| Reviews \| 1 \|/);
  assert.match(md, /\| Review Outcome: pass \| 1 \|/);
  assert.match(md, /\| Goose Calls \| 1 \|/);
  assert.match(md, /\| Goose Success \| 1 \|/);
  assert.match(md, /\| Conflict: resolved \| 1 \|/);
  assert.match(md, /\| Merge: merged \| 1 \|/);
  assert.match(md, /\| Cache Hit: review \| 1 \|/);
});

test("reset clears all metrics", () => {
  const mc = new MetricsCollector();
  mc.recordReviewDuration(100);
  mc.recordReviewResult("pass");
  mc.recordGooseCall(200, false);
  mc.recordConflictResolution("failed");
  mc.recordMergeAttempt("failed");
  mc.recordCacheHit("knowledge");
  mc.reset();

  const s = mc.snapshot();
  assert.equal(s.reviewCount, 0);
  assert.equal(s.reviewDurationTotalMs, 0);
  assert.equal(s.reviewDurationAvgMs, 0);
  assert.deepEqual(s.reviewOutcomes, {});
  assert.equal(s.gooseCallCount, 0);
  assert.equal(s.gooseCallDurationTotalMs, 0);
  assert.equal(s.gooseCallAvgMs, 0);
  assert.equal(s.gooseSuccessCount, 0);
  assert.equal(s.gooseFailureCount, 0);
  assert.deepEqual(s.conflictStatuses, {});
  assert.deepEqual(s.mergeStatuses, {});
  assert.deepEqual(s.cacheHits, {});
});

test("Multiple calls accumulate correctly", () => {
  const mc = new MetricsCollector();
  for (let i = 0; i < 10; i++) {
    mc.recordReviewDuration(100);
    mc.recordReviewResult("pass");
    mc.recordGooseCall(200, i % 3 !== 0);
    mc.recordConflictResolution(i < 5 ? "resolved" : "failed");
    mc.recordMergeAttempt(i < 7 ? "merged" : "failed");
    mc.recordCacheHit(i < 6 ? "review" : "knowledge");
  }

  const s = mc.snapshot();
  assert.equal(s.reviewCount, 10);
  assert.equal(s.reviewDurationTotalMs, 1000);
  assert.equal(s.reviewDurationAvgMs, 100);
  assert.equal(s.gooseCallCount, 10);
  assert.equal(s.gooseCallDurationTotalMs, 2000);
  assert.equal(s.gooseCallAvgMs, 200);
  // 10 calls; i%3===0 fails (indices 0,3,6,9 = 4), rest succeed (indices 1,2,4,5,7,8 = 6)
  assert.equal(s.gooseSuccessCount, 6);
  assert.equal(s.gooseFailureCount, 4);
  // i < 5 resolved, rest failed
  const conflicts = s.conflictStatuses as Record<string, number>;
  assert.equal(conflicts.resolved, 5);
  assert.equal(conflicts.failed, 5);
  // i < 7 merged, rest failed
  const merges = s.mergeStatuses as Record<string, number>;
  assert.equal(merges.merged, 7);
  assert.equal(merges.failed, 3);
  // i < 6 review, rest knowledge
  const cache = s.cacheHits as Record<string, number>;
  assert.equal(cache.review, 6);
  assert.equal(cache.knowledge, 4);
});

test("singleton is exported", () => {
  assert.ok(metrics instanceof MetricsCollector);
});
