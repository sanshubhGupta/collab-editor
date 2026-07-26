// server/metrics.ts
import { Registry, Gauge, Counter, Histogram } from "prom-client";

export const registry = new Registry();

export const activeConnectionsGauge = new Gauge({
  name: "active_ws_connections",
  help: "Current number of active WebSocket connections",
  registers: [registry],
});

export const yjsMessagesCounter = new Counter({
  name: "yjs_messages_total",
  help: "Total number of Yjs updates processed",
  registers: [registry],
});

// Percentiles matter more than the average for user-facing latency — a
// histogram lets Prometheus compute p50/p95/p99 later, which a single
// average could never reveal (a few slow outliers get hidden by an average
// but show up clearly at p95/p99).
export const syncLatencyHistogram = new Histogram({
  name: "sync_latency_ms",
  help: "Time in ms between receiving a yjs-update and completing the broadcast to other clients",
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [registry],
});

export async function getMetricsText(): Promise<string> {
  return registry.metrics();
}

export const metricsContentType = registry.contentType;