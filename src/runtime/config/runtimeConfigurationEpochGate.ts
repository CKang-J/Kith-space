import { ModelControlError } from "../../model-control/contracts.js";

type Waiter = { type: "read" | "write"; run: () => void };

/** Process-local admission barrier. It starts closed after every Core restart. */
export class RuntimeConfigurationEpochGate {
  private epoch: number | null = null;
  private readers = 0;
  private writer = false;
  private readonly waiters: Waiter[] = [];

  open(epoch: number): void {
    if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error("invalid runtime configuration epoch");
    this.epoch = epoch;
  }

  closeBefore(epoch: number): void {
    if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error("invalid runtime configuration epoch");
    if (this.epoch === null || this.epoch < epoch) this.epoch = null;
  }

  close(): void {
    this.epoch = null;
  }

  current(): number | null {
    return this.epoch;
  }

  async withAdmission<T>(expectedEpoch: number, operation: () => Promise<T> | T): Promise<T> {
    await this.acquireRead();
    try {
      if (this.epoch !== expectedEpoch) throw new ModelControlError("runtime_configuration_stale");
      return await operation();
    } finally {
      this.readers -= 1;
      this.drain();
    }
  }

  async withChange<T>(operation: () => Promise<T> | T): Promise<T> {
    await this.acquireWrite();
    this.epoch = null;
    try {
      return await operation();
    } finally {
      this.writer = false;
      this.drain();
    }
  }

  private acquireRead(): Promise<void> {
    if (!this.writer && !this.waiters.some((waiter) => waiter.type === "write")) {
      this.readers += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push({
      type: "read",
      run: () => {
        this.readers += 1;
        resolve();
      },
    }));
  }

  private acquireWrite(): Promise<void> {
    if (!this.writer && this.readers === 0 && this.waiters.length === 0) {
      this.writer = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push({
      type: "write",
      run: () => {
        this.writer = true;
        resolve();
      },
    }));
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

export const runtimeConfigurationEpochGate = new RuntimeConfigurationEpochGate();
