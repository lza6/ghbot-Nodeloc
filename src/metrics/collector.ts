/**
 * MetricsCollector — 纯内存指标累加器。
 * 用于 CI Actions 模式，提供 snapshot 和 markdown 序列化。
 * 与 webhook 的 MetricsRegistry（Prometheus 格式）互补，面向人类可读输出。
 */

export class MetricsCollector {
  private reviewCount = 0;
  private reviewDurationTotalMs = 0;
  private reviewOutcomes: Record<string, number> = {};
  private gooseCallCount = 0;
  private gooseCallDurationMs = 0;
  private gooseSuccessCount = 0;
  private gooseFailureCount = 0;
  private conflictStatuses: Record<string, number> = {};
  private mergeStatuses: Record<string, number> = {};
  private cacheHits: Record<string, number> = {};
  private startedAt = Date.now();

  recordReviewDuration(ms: number): void {
    this.reviewCount++;
    this.reviewDurationTotalMs += ms;
  }

  recordReviewResult(outcome: "pass" | "block" | "malicious"): void {
    this.reviewOutcomes[outcome] = (this.reviewOutcomes[outcome] ?? 0) + 1;
  }

  recordGooseCall(durationMs: number, success: boolean): void {
    this.gooseCallCount++;
    this.gooseCallDurationMs += durationMs;
    if (success) {
      this.gooseSuccessCount++;
    } else {
      this.gooseFailureCount++;
    }
  }

  recordConflictResolution(status: "resolved" | "failed" | "skipped"): void {
    this.conflictStatuses[status] = (this.conflictStatuses[status] ?? 0) + 1;
  }

  recordMergeAttempt(status: "merged" | "already_merged" | "failed"): void {
    this.mergeStatuses[status] = (this.mergeStatuses[status] ?? 0) + 1;
  }

  recordCacheHit(type: "review" | "knowledge"): void {
    this.cacheHits[type] = (this.cacheHits[type] ?? 0) + 1;
  }

  snapshot(): Record<string, unknown> {
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      reviewCount: this.reviewCount,
      reviewDurationTotalMs: this.reviewDurationTotalMs,
      reviewDurationAvgMs:
        this.reviewCount > 0 ? Math.round(this.reviewDurationTotalMs / this.reviewCount) : 0,
      reviewOutcomes: { ...this.reviewOutcomes },
      gooseCallCount: this.gooseCallCount,
      gooseCallDurationTotalMs: this.gooseCallDurationMs,
      gooseCallAvgMs:
        this.gooseCallCount > 0 ? Math.round(this.gooseCallDurationMs / this.gooseCallCount) : 0,
      gooseSuccessCount: this.gooseSuccessCount,
      gooseFailureCount: this.gooseFailureCount,
      conflictStatuses: { ...this.conflictStatuses },
      mergeStatuses: { ...this.mergeStatuses },
      cacheHits: { ...this.cacheHits }
    };
  }

  formatMarkdown(): string {
    const s = this.snapshot();

    const lines: string[] = [
      "## Metrics Summary",
      "",
      "| Metric | Value |",
      "|--------|-------|",
      `| Uptime | ${s.uptimeSeconds}s |`,
      `| Reviews | ${s.reviewCount} |`,
      `| Review Duration (total) | ${s.reviewDurationTotalMs}ms |`,
      `| Review Duration (avg) | ${s.reviewDurationAvgMs}ms |`
    ];

    const outcomes = s.reviewOutcomes as Record<string, number>;
    for (const [outcome, count] of Object.entries(outcomes).sort()) {
      lines.push(`| Review Outcome: ${outcome} | ${count} |`);
    }

    lines.push(
      `| Goose Calls | ${s.gooseCallCount} |`,
      `| Goose Call Duration (total) | ${s.gooseCallDurationTotalMs}ms |`,
      `| Goose Call Duration (avg) | ${s.gooseCallAvgMs}ms |`,
      `| Goose Success | ${s.gooseSuccessCount} |`,
      `| Goose Failure | ${s.gooseFailureCount} |`
    );

    const conflicts = s.conflictStatuses as Record<string, number>;
    for (const [status, count] of Object.entries(conflicts).sort()) {
      lines.push(`| Conflict: ${status} | ${count} |`);
    }

    const merges = s.mergeStatuses as Record<string, number>;
    for (const [status, count] of Object.entries(merges).sort()) {
      lines.push(`| Merge: ${status} | ${count} |`);
    }

    const cache = s.cacheHits as Record<string, number>;
    for (const [type, count] of Object.entries(cache).sort()) {
      lines.push(`| Cache Hit: ${type} | ${count} |`);
    }

    return `${lines.join("\n")}\n`;
  }

  reset(): void {
    this.reviewCount = 0;
    this.reviewDurationTotalMs = 0;
    this.reviewOutcomes = {};
    this.gooseCallCount = 0;
    this.gooseCallDurationMs = 0;
    this.gooseSuccessCount = 0;
    this.gooseFailureCount = 0;
    this.conflictStatuses = {};
    this.mergeStatuses = {};
    this.cacheHits = {};
    this.startedAt = Date.now();
  }
}

export const metrics = new MetricsCollector();
