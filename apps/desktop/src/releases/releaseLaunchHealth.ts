export const RELEASE_HEALTHY_STARTUP_WINDOW_MS = 30_000;
export const RELEASE_FAILED_LAUNCH_LIMIT = 2;

export interface ReleaseLaunchHealth {
  readonly consecutiveFailures: number;
  readonly startedAtMs: number | null;
}

export interface ReleaseAutoRevertNotice {
  readonly fromVersion: string;
  readonly reason: string;
}

export interface ReleaseLaunchState {
  readonly selectedTargetId: string | null;
  readonly selectedTargetVersion: string | null;
  readonly health: ReleaseLaunchHealth;
  readonly autoRevertNotice: ReleaseAutoRevertNotice | null;
}

export interface ReleaseLaunchDecision {
  readonly state: ReleaseLaunchState;
  readonly revertedFromVersion: string | null;
}

const emptyHealth: ReleaseLaunchHealth = {
  consecutiveFailures: 0,
  startedAtMs: null,
};

function isPendingFailure(health: ReleaseLaunchHealth, nowMs: number): boolean {
  return (
    health.startedAtMs !== null &&
    nowMs >= health.startedAtMs &&
    nowMs - health.startedAtMs <= RELEASE_HEALTHY_STARTUP_WINDOW_MS
  );
}

export function beginReleaseLaunch(
  state: ReleaseLaunchState,
  nowMs: number,
): ReleaseLaunchDecision {
  if (state.selectedTargetId === null) {
    return {
      state: { ...state, health: emptyHealth },
      revertedFromVersion: null,
    };
  }

  const consecutiveFailures = isPendingFailure(state.health, nowMs)
    ? state.health.consecutiveFailures + 1
    : 0;

  if (consecutiveFailures >= RELEASE_FAILED_LAUNCH_LIMIT) {
    const fromVersion = state.selectedTargetVersion ?? state.selectedTargetId;
    return {
      state: {
        selectedTargetId: null,
        selectedTargetVersion: null,
        health: emptyHealth,
        autoRevertNotice: {
          fromVersion,
          reason: `The pinned release failed to reach a healthy startup twice within ${RELEASE_HEALTHY_STARTUP_WINDOW_MS / 1000} seconds.`,
        },
      },
      revertedFromVersion: fromVersion,
    };
  }

  return {
    state: {
      ...state,
      health: {
        consecutiveFailures,
        startedAtMs: nowMs,
      },
    },
    revertedFromVersion: null,
  };
}

export function markReleaseLaunchHealthy(state: ReleaseLaunchState): ReleaseLaunchState {
  return { ...state, health: emptyHealth };
}
