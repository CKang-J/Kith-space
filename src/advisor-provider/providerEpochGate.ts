import { AdvisorProviderError } from "./contracts.js";

type Waiter = { type: "read" | "write"; run: () => void };

/** Process-local read/write barrier. It starts closed after every Core restart. */
export class ProviderEpochGate {
  private epoch: number | null = null;
  private readers = 0;
  private writer = false;
  private readonly waiters: Waiter[] = [];

  open(epoch: number): void {
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error("invalid provider epoch");
    this.epoch = epoch;
  }

  close(): void { this.epoch = null; }

  async withRead<T>(expectedEpoch: number, operation: () => Promise<T> | T): Promise<T> {
    await this.acquireRead();
    try {
      if (this.epoch === null || this.epoch !== expectedEpoch) throw new AdvisorProviderError("provider_revision_changed");
      return await operation();
    } finally {
      this.readers -= 1;
      this.drain();
    }
  }

  async withWrite<T>(operation: () => Promise<T> | T): Promise<T> {
    await this.acquireWrite();
    this.epoch = null;
    try { return await operation(); }
    finally { this.writer = false; this.drain(); }
  }

  private acquireRead(): Promise<void> {
    if (!this.writer && !this.waiters.some((waiter) => waiter.type === "write")) {
      this.readers += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push({ type: "read", run: () => { this.readers += 1; resolve(); } }));
  }

  private acquireWrite(): Promise<void> {
    if (!this.writer && this.readers === 0 && this.waiters.length === 0) {
      this.writer = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push({ type: "write", run: () => { this.writer = true; resolve(); } }));
  }

  private drain(): void {
    if (this.writer || this.readers > 0 || this.waiters.length === 0) return;
    if (this.waiters[0]!.type === "write") {
      this.waiters.shift()!.run();
      return;
    }
    while (this.waiters[0]?.type === "read") this.waiters.shift()!.run();
  }
}

export const providerEpochGate = new ProviderEpochGate();
