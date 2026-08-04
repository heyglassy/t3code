import { describe, expect, it } from "vite-plus/test";

import {
  beginReleaseLaunch,
  markReleaseLaunchHealthy,
  RELEASE_HEALTHY_STARTUP_WINDOW_MS,
  type ReleaseLaunchState,
} from "./releaseLaunchHealth.ts";

const pinnedState: ReleaseLaunchState = {
  selectedTargetId: "release-42",
  selectedTargetVersion: "0.0.42",
  health: { consecutiveFailures: 0, startedAtMs: null },
  autoRevertNotice: null,
};

describe("release launch health", () => {
  it("starts a pinned launch with a pending healthy marker", () => {
    expect(beginReleaseLaunch(pinnedState, 1_000)).toEqual({
      revertedFromVersion: null,
      state: {
        ...pinnedState,
        health: { consecutiveFailures: 0, startedAtMs: 1_000 },
      },
    });
  });

  it("clears the failure streak when the main renderer becomes healthy", () => {
    const pending = beginReleaseLaunch(pinnedState, 1_000).state;
    expect(markReleaseLaunchHealthy(pending)).toEqual(pinnedState);
  });

  it("reverts after two consecutive launches miss the health marker", () => {
    const firstLaunch = beginReleaseLaunch(pinnedState, 1_000).state;
    const secondLaunch = beginReleaseLaunch(firstLaunch, 2_000).state;
    const thirdLaunch = beginReleaseLaunch(secondLaunch, 3_000);

    expect(thirdLaunch.revertedFromVersion).toBe("0.0.42");
    expect(thirdLaunch.state.selectedTargetId).toBeNull();
    expect(thirdLaunch.state.selectedTargetVersion).toBeNull();
    expect(thirdLaunch.state.autoRevertNotice?.fromVersion).toBe("0.0.42");
    expect(thirdLaunch.state.autoRevertNotice?.reason).toContain("twice");
  });

  it("does not carry a failure across a launch that outlives the health window", () => {
    const firstLaunch = beginReleaseLaunch(pinnedState, 1_000).state;
    const laterLaunch = beginReleaseLaunch(
      firstLaunch,
      1_000 + RELEASE_HEALTHY_STARTUP_WINDOW_MS + 1,
    );

    expect(laterLaunch.revertedFromVersion).toBeNull();
    expect(laterLaunch.state.health).toEqual({
      consecutiveFailures: 0,
      startedAtMs: 1_000 + RELEASE_HEALTHY_STARTUP_WINDOW_MS + 1,
    });
  });

  it("does not track follow-channel launches", () => {
    const state: ReleaseLaunchState = {
      ...pinnedState,
      selectedTargetId: null,
      selectedTargetVersion: null,
      health: { consecutiveFailures: 1, startedAtMs: 1_000 },
    };

    expect(beginReleaseLaunch(state, 2_000).state.health).toEqual({
      consecutiveFailures: 0,
      startedAtMs: null,
    });
  });
});
