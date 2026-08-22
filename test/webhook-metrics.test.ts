import assert from "node:assert/strict";
import test from "node:test";
import { MetricsRegistry } from "../src/webhook/metrics.js";

test("counters accumulate and serialize with sorted stable output", () => {
  const registry = new MetricsRegistry();
  registry.inc("reviews_total", { outcome: "pass" });
  registry.inc("reviews_total", { outcome: "pass" });
  registry.inc("reviews_total", { outcome: "block" });
  const output = registry.snapshotPrometheus();
  assert.match(output, /ghbot_reviews_total\{outcome="pass"\} 2/);
  assert.match(output, /ghbot_reviews_total\{outcome="block"\} 1/);
  assert.match(output, /ghbot_uptime_seconds \d+/);
});

test("label values are escaped for the Prometheus text format", () => {
  const registry = new MetricsRegistry();
  registry.inc("events_total", { repo: 'acme "x"\n' });
  const output = registry.snapshotPrometheus();
  assert.ok(output.includes('ghbot_events_total{repo="acme \\"x\\"\\n"} 1'));
});

test("durations produce count, sum, and quantiles", () => {
  const registry = new MetricsRegistry();
  registry.observeDuration("review_duration_ms", 100);
  registry.observeDuration("review_duration_ms", 300);
  const output = registry.snapshotPrometheus();
  assert.match(output, /ghbot_review_duration_ms_count 2/);
  assert.match(output, /ghbot_review_duration_ms_sum_ms 400/);
  assert.match(output, /ghbot_duration_ms\{quantile="0.5"\} \d+/);
  assert.match(output, /ghbot_duration_ms\{quantile="0.95"\} \d+/);
});

test("an empty registry still emits uptime", () => {
  const output = new MetricsRegistry().snapshotPrometheus();
  assert.match(output, /ghbot_uptime_seconds/);
});
