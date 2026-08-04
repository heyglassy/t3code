import { describe, expect, it } from "vite-plus/test";

import type { ReleaseCatalog } from "@t3tools/contracts";

import {
  resolveReleaseFeedUrl,
  selectReleaseTarget,
  validateDesktopReleaseTarget,
  verifyReleaseUpdate,
} from "./releaseSelection.ts";

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
      architecture: "arm64",
      schemaVersion: 1,
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

  it("resolves the immutable feed published by the release workflow", () => {
    expect(
      resolveReleaseFeedUrl({
        entry: catalog.releases[0]!,
        channelFeedUrl: "https://updates.example.com/desktop/",
      }),
    ).toBe("https://updates.example.com/desktop/releases/1.0.0/");
  });

  it("prefers an entry-specific feed URL", () => {
    expect(
      resolveReleaseFeedUrl({
        entry: { ...catalog.releases[0]!, updateFeedUrl: "https://mirror.example/releases/1/" },
        channelFeedUrl: "https://updates.example.com/desktop",
      }),
    ).toBe("https://mirror.example/releases/1/");
  });

  it("rejects incompatible schema and architecture targets", () => {
    expect(
      validateDesktopReleaseTarget(
        { ...catalog.releases[0]!, schemaVersion: 2 },
        { platform: "darwin", appArch: "arm64" },
      ).error,
    ).toContain("data schema version 2");
    expect(
      validateDesktopReleaseTarget(
        { ...catalog.releases[0]!, architecture: "x64" },
        { platform: "darwin", appArch: "arm64" },
      ).error,
    ).toContain("targets x64");
  });

  it("verifies the selected version and optional commit metadata", () => {
    expect(
      verifyReleaseUpdate(catalog.releases[0]!, { version: "1.0.0", commitSha: "abc123" }),
    ).toEqual({ accepted: true, error: null });
    expect(
      verifyReleaseUpdate(catalog.releases[0]!, { version: "1.0.1", commitSha: "abc123" }).error,
    ).toContain("does not match selected version");
    expect(
      verifyReleaseUpdate(catalog.releases[0]!, { version: "1.0.0", commitSha: "wrong" }).error,
    ).toContain("does not match selected commit");
  });
});
