import { describe, expect, it } from "vite-plus/test";

import type { ReleaseCatalog } from "@t3tools/contracts";

import { selectReleaseTarget } from "./releaseSelection.ts";

const catalog: ReleaseCatalog = {
  schemaVersion: 1,
  generatedAt: "2026-08-03T00:00:00.000Z",
  releases: [
    {
      id: "stable-1",
      channel: "stable",
      platform: "desktop",
      version: "1.0.0",
      commitSha: "abc123",
    },
  ],
};

describe("release selection", () => {
  it("records a valid immutable target and requires restart", () => {
    expect(selectReleaseTarget(catalog, "stable-1", null)).toEqual({
      accepted: true,
      selectedTargetId: "stable-1",
      restartRequired: true,
    });
  });

  it("does not overwrite selection for an unknown target", () => {
    expect(selectReleaseTarget(catalog, "missing", "stable-1")).toEqual({
      accepted: false,
      selectedTargetId: "stable-1",
      restartRequired: true,
    });
  });
});
