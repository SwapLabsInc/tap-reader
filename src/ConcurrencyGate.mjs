import { TimeoutError } from "./AsyncUtils.mjs";

export class BusyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BusyError";
    this.code = "SERVER_BUSY";
    this.details = details;
  }
}

export default class ConcurrencyGate {
  constructor(name, maxActive, maxQueued) {
    this.name = name;
    this.maxActive = maxActive;
    this.maxQueued = maxQueued;
    this.active = 0;
    this.queue = [];
  }

  async acquire(options = {}) {
    const { maxWaitMs = null } = options;

    if (this.active < this.maxActive) {
      return this.enter();
    }

    if (this.queue.length >= this.maxQueued) {
      throw new BusyError(`${this.name} queue is full`, this.getSnapshot());
    }

    return await new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        cancelled: false,
        timer: null,
      };

      if (Number.isFinite(maxWaitMs) && maxWaitMs > 0) {
        entry.timer = setTimeout(() => {
          entry.cancelled = true;
          const index = this.queue.indexOf(entry);
          if (index !== -1) {
            this.queue.splice(index, 1);
          }
          reject(
            new TimeoutError(
              `Request timed out while waiting for ${this.name}`,
              maxWaitMs,
              this.getSnapshot()
            )
          );
        }, maxWaitMs);
        entry.timer.unref?.();
      }

      this.queue.push(entry);
    });
  }

  async run(task, options = {}) {
    const release = await this.acquire(options);

    try {
      return await task();
    } finally {
      release();
    }
  }

  getSnapshot() {
    return {
      name: this.name,
      active: this.active,
      queued: this.queue.length,
      maxActive: this.maxActive,
      maxQueued: this.maxQueued,
    };
  }

  enter() {
    this.active += 1;
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.active = Math.max(0, this.active - 1);
      this.flushQueue();
    };
  }

  flushQueue() {
    while (this.active < this.maxActive && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next.cancelled) {
        continue;
      }

      if (next.timer !== null) {
        clearTimeout(next.timer);
      }
      next.resolve(this.enter());
    }
  }
}
