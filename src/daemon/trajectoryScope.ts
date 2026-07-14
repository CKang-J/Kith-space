export type TrajectoryScopeState =
  | { kind: "unscoped" }
  | { kind: "ambiguous" }
  | { kind: "scoped"; channelId: string; streamId?: string };

export const UNSCOPED_TRAJECTORY: TrajectoryScopeState = { kind: "unscoped" };

export function trajectoryScopeForDelivery(channelId: string, streamId?: string): TrajectoryScopeState {
  const target = channelId.trim();
  return target ? { kind: "scoped", channelId: target, ...(streamId ? { streamId } : {}) } : UNSCOPED_TRAJECTORY;
}

export function mergeTrajectoryScopes(left: TrajectoryScopeState, right: TrajectoryScopeState): TrajectoryScopeState {
  if (left.kind === "ambiguous" || right.kind === "ambiguous") return { kind: "ambiguous" };
  if (left.kind === "unscoped" || right.kind === "unscoped") {
    return left.kind === right.kind ? UNSCOPED_TRAJECTORY : { kind: "ambiguous" };
  }
  if (left.channelId !== right.channelId) return { kind: "ambiguous" };
  return {
    kind: "scoped",
    channelId: right.channelId,
    ...(right.streamId || left.streamId ? { streamId: right.streamId ?? left.streamId } : {}),
  };
}

export function trajectoryScopeForDeliveries(
  deliveries: Array<{ target: string; streamId?: string }>,
): TrajectoryScopeState {
  const first = deliveries[0];
  if (!first) return UNSCOPED_TRAJECTORY;
  return deliveries.slice(1).reduce(
    (scope, delivery) => mergeTrajectoryScopes(scope, trajectoryScopeForDelivery(delivery.target, delivery.streamId)),
    trajectoryScopeForDelivery(first.target, first.streamId),
  );
}

export function trajectoryScopePayload(scope: TrajectoryScopeState): {
  scope: TrajectoryScopeState["kind"];
  channelId?: string;
  streamId?: string;
} {
  if (scope.kind !== "scoped") return { scope: scope.kind };
  return {
    scope: scope.kind,
    channelId: scope.channelId,
    ...(scope.streamId ? { streamId: scope.streamId } : {}),
  };
}

/** Keeps delivery scope aligned with the serial runtime turn queue. */
export class TrajectoryScopeTracker {
  private currentScope: TrajectoryScopeState;
  private turnOpen = true;
  private queued: TrajectoryScopeState[] = [];
  private revision = 0;

  constructor(initialScope: TrajectoryScopeState = UNSCOPED_TRAJECTORY) {
    this.currentScope = initialScope;
  }

  schedule(scope: TrajectoryScopeState): TrajectoryScopeScheduleToken {
    const previous = {
      currentScope: this.currentScope,
      turnOpen: this.turnOpen,
      queued: [...this.queued],
    };
    if (!this.turnOpen && this.queued.length === 0) {
      this.currentScope = scope;
      this.turnOpen = true;
    } else {
      this.queued.push(scope);
    }
    this.revision += 1;
    return { revision: this.revision, previous };
  }

  rollback(token: TrajectoryScopeScheduleToken): boolean {
    if (token.revision !== this.revision) return false;
    this.currentScope = token.previous.currentScope;
    this.turnOpen = token.previous.turnOpen;
    this.queued = [...token.previous.queued];
    this.revision += 1;
    return true;
  }

  beginTurn(): TrajectoryScopeState {
    if (!this.turnOpen) {
      this.currentScope = this.queued.shift() ?? UNSCOPED_TRAJECTORY;
      this.turnOpen = true;
      this.revision += 1;
    }
    return this.currentScope;
  }

  current(): TrajectoryScopeState {
    return this.turnOpen ? this.currentScope : UNSCOPED_TRAJECTORY;
  }

  finishTurn(): TrajectoryScopeState {
    const finished = this.current();
    this.currentScope = UNSCOPED_TRAJECTORY;
    this.turnOpen = false;
    this.revision += 1;
    return finished;
  }
}

export interface TrajectoryScopeScheduleToken {
  revision: number;
  previous: {
    currentScope: TrajectoryScopeState;
    turnOpen: boolean;
    queued: TrajectoryScopeState[];
  };
}
