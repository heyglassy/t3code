import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ReleaseCatalogSchema } from "./releaseCatalog.ts";

const decodeCatalog = Schema.decodeUnknownSync(ReleaseCatalogSchema);

describe("release catalog contract", () => {
  it("decodes release provenance and update identifiers", () => {
    const catalog = decodeCatalog({
      schemaVersion: 1,
      generatedAt: "2026-08-03T00:00:00.000Z",
      releases: [
        {
          id: "desktop-pr-42-a1b2c3d",
          channel: "preview",
          platform: "desktop",
          version: "0.0.32-preview.1",
          commitSha: "a1b2c3d4e5f6",
          branch: "pr-42",
          prNumber: 42,
          prTitle: "Fix terminal rendering",
          prUrl: "https://github.com/heyglassy/t3code/pull/42",
          buildId: "desktop-build-123",
          updateId: "update-456",
          updateFeedUrl: "https://releases.example.com/releases/0.0.32-preview.1/",
          architecture: "arm64",
          runtimeFingerprint: "desktop-darwin-arm64",
          createdAt: "2026-08-03T00:00:00.000Z",
        },
      ],
    });

    expect(catalog.releases[0]).toMatchObject({
      commitSha: "a1b2c3d4e5f6",
      prNumber: 42,
      updateId: "update-456",
    });
  });

  it("rejects a catalog without an immutable commit SHA", () => {
    expect(() =>
      decodeCatalog({
        schemaVersion: 1,
        generatedAt: "2026-08-03T00:00:00.000Z",
        releases: [
          {
            id: "stable-1",
            channel: "stable",
            platform: "desktop",
            version: "1.0.0",
            commitSha: "",
          },
        ],
      }),
    ).toThrow();
  });
});
