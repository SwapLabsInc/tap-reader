import { monitorEventLoopDelay } from "node:perf_hooks";
import { formatError } from "./AsyncUtils.mjs";

const HEALTH_LOG_INTERVAL_MS = 60_000;
const SLOW_REQUEST_MS = 1_000;
const VERY_SLOW_REQUEST_MS = 5_000;

function toRoundedMs(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function topEntries(map, limit = 5) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}

export default class RequestMonitor {
  constructor(name, snapshotProvider = () => ({})) {
    this.name = name;
    this.snapshotProvider = snapshotProvider;
    this.inflightTotal = 0;
    this.inflightByFunc = new Map();
    this.completedSinceLastHealth = new Map();
    this.statusCountsSinceLastHealth = {
      success: 0,
      error: 0,
      timeout: 0,
      invalid: 0,
      busy: 0,
    };
    this.eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.eventLoopDelay.enable();
    this.interval = setInterval(() => {
      this.logHealth("interval");
    }, HEALTH_LOG_INTERVAL_MS);
    this.interval.unref?.();
  }

  start(func, metadata = {}) {
    this.inflightTotal += 1;
    this.inflightByFunc.set(func, (this.inflightByFunc.get(func) ?? 0) + 1);

    return {
      func,
      metadata,
      startedAt: Date.now(),
      status: "success",
      responseSent: false,
    };
  }

  finish(context, status = context.status, error = null) {
    const finishedAt = Date.now();
    const durationMs = finishedAt - context.startedAt;
    const inflightCount = this.inflightByFunc.get(context.func) ?? 0;

    this.inflightTotal = Math.max(0, this.inflightTotal - 1);
    if (inflightCount <= 1) {
      this.inflightByFunc.delete(context.func);
    } else {
      this.inflightByFunc.set(context.func, inflightCount - 1);
    }

    this.completedSinceLastHealth.set(
      context.func,
      (this.completedSinceLastHealth.get(context.func) ?? 0) + 1
    );
    this.statusCountsSinceLastHealth[status] =
      (this.statusCountsSinceLastHealth[status] ?? 0) + 1;

    const payload = {
      func: context.func,
      callId: context.metadata.callId ?? null,
      socketId: context.metadata.socketId ?? null,
      durationMs,
      inflightTotal: this.inflightTotal,
      status,
    };

    if (status !== "success") {
      console.error(`[${this.name}] request ${status}`, {
        ...payload,
        error: formatError(error),
      });
      return;
    }

    if (durationMs >= VERY_SLOW_REQUEST_MS) {
      console.warn(`[${this.name}] request very slow`, payload);
      return;
    }

    if (durationMs >= SLOW_REQUEST_MS) {
      console.warn(`[${this.name}] request slow`, payload);
    }
  }

  getSnapshot() {
    return {
      inflightTotal: this.inflightTotal,
      inflightByFunc: topEntries(this.inflightByFunc),
      eventLoopLagMs: {
        mean: toRoundedMs(this.eventLoopDelay.mean / 1e6),
        max: toRoundedMs(this.eventLoopDelay.max / 1e6),
        p99: toRoundedMs(this.eventLoopDelay.percentile(99) / 1e6),
      },
    };
  }

  logHealth(reason = "manual") {
    const memory = process.memoryUsage();
    const snapshot = this.snapshotProvider();

    console.log(`[${this.name}] health`, {
      reason,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
      inflightTotal: this.inflightTotal,
      inflightByFunc: topEntries(this.inflightByFunc),
      completedByFunc: topEntries(this.completedSinceLastHealth),
      statusCounts: { ...this.statusCountsSinceLastHealth },
      eventLoopLagMs: {
        mean: toRoundedMs(this.eventLoopDelay.mean / 1e6),
        max: toRoundedMs(this.eventLoopDelay.max / 1e6),
        p99: toRoundedMs(this.eventLoopDelay.percentile(99) / 1e6),
      },
      ...snapshot,
    });

    this.completedSinceLastHealth.clear();
    this.statusCountsSinceLastHealth = {
      success: 0,
      error: 0,
      timeout: 0,
      invalid: 0,
      busy: 0,
    };
    this.eventLoopDelay.reset();
  }

  destroy() {
    clearInterval(this.interval);
    this.eventLoopDelay.disable();
  }
}
