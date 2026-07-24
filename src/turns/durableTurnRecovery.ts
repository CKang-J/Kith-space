export const DEFAULT_DURABLE_TURN_RECOVERY_INTERVAL_MS = 5_000;

export interface DurableTurnRecoveryTimer {
  setInterval(callback: () => void, intervalMs: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
}

export interface DurableTurnRecoveryOptions {
  listSpaceIds(): readonly string[];
  recoverSpace(spaceId: string): Promise<void>;
  intervalMs?: number;
  timer?: DurableTurnRecoveryTimer;
  onSpaceError?(spaceId: string | null, error: unknown): void;
}

export interface DurableTurnRecoveryResult {
  skipped: boolean;
  attempted: number;
  recovered: number;
  failed: number;
}

const systemTimer: DurableTurnRecoveryTimer = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (timer) => clearInterval(timer),
};

/**
 * Best-effort Core safety net for post-commit delivery scheduling loss.
 *
 * This scanner deliberately delegates all actionability, reservation, logical-turn and lease
 * decisions to HarnessTurnScheduler. Its only responsibilities are enumerating registered Spaces,
 * serializing ticks, isolating unavailable Space roots, and owning its lifecycle timer.
 */
export class DurableTurnRecovery {
  private readonly intervalMs: number;
  private readonly timerPort: DurableTurnRecoveryTimer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly options: DurableTurnRecoveryOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_DURABLE_TURN_RECOVERY_INTERVAL_MS;
    this.timerPort = options.timer ?? systemTimer;
  }

  start(): Promise<DurableTurnRecoveryResult> {
    if (this.timer) return Promise.resolve({ skipped: true, attempted: 0, recovered: 0, failed: 0 });
    this.timer = this.timerPort.setInterval(() => { void this.tick(); }, this.intervalMs);
    this.timer.unref?.();
    return this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    this.timerPort.clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<DurableTurnRecoveryResult> {
    if (this.ticking) return { skipped: true, attempted: 0, recovered: 0, failed: 0 };
    this.ticking = true;
    let spaceIds: string[];
    try {
      spaceIds = [...new Set(this.options.listSpaceIds())];
    } catch (error) {
      this.options.onSpaceError?.(null, error);
      this.ticking = false;
      return { skipped: false, attempted: 0, recovered: 0, failed: 1 };
    }
    let recovered = 0;
    let failed = 0;
    try {
      for (const spaceId of spaceIds) {
        try {
          await this.options.recoverSpace(spaceId);
          recovered += 1;
        } catch (error) {
          failed += 1;
          this.options.onSpaceError?.(spaceId, error);
        }
      }
      return { skipped: false, attempted: spaceIds.length, recovered, failed };
    } finally {
      this.ticking = false;
    }
  }
}
