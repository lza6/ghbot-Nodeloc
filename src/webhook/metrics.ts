/**
 * Webhook 运行期指标：纯内存累加器 + Prometheus 文本格式序列化。
 * 无外部依赖；webhook 服务通过 /metrics 端点暴露。
 */

type CounterKey = string;

export class MetricsRegistry {
  private readonly counters = new Map<CounterKey, number>();
  private readonly durations: number[] = [];
  private readonly startedAt = Date.now();

  inc(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = serializeMetricName(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  observeDuration(name: string, ms: number): void {
    this.durations.push(ms);
    this.inc(`${name}_count`);
    this.inc(`${name}_sum_ms`, {}, ms);
  }

  snapshotPrometheus(): string {
    const lines: string[] = [];
    lines.push(`# TYPE ghbot_uptime_seconds gauge`);
    lines.push(`ghbot_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`);
    for (const [key, value] of [...this.counters.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      lines.push(`${key} ${value}`);
    }
    if (this.durations.length > 0) {
      const sorted = [...this.durations].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      lines.push(`# TYPE ghbot_duration_ms summary`);
      lines.push(`ghbot_duration_ms{quantile="0.5"} ${p50}`);
      lines.push(`ghbot_duration_ms{quantile="0.95"} ${p95}`);
    }
    return `${lines.join("\n")}\n`;
  }
}

function serializeMetricName(name: string, labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return `ghbot_${name}`;
  }
  const labelString = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(",");
  return `ghbot_${name}{${labelString}}`;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
