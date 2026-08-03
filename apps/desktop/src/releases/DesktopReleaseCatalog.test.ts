import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopReleaseCatalog from "./DesktopReleaseCatalog.ts";

const catalogJson = JSON.stringify({
  schemaVersion: 1,
  generatedAt: "2026-08-03T00:00:00.000Z",
  releases: [
    {
      id: "preview-42",
      channel: "preview",
      platform: "desktop",
      version: "0.0.32-preview.1",
      commitSha: "abc123",
      branch: "pr-42",
      prNumber: 42,
    },
  ],
});

function makeLayer(baseDir: string) {
  const environmentLayer = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "0.0.31",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );

  return DesktopReleaseCatalog.layer.pipe(
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(NodeHttpClient.layerUndici),
  );
}

describe("DesktopReleaseCatalog", () => {
  it.effect("loads a local catalog and persists a validated target selection", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-release-catalog-test-",
      });
      const catalogPath = `${baseDir}/catalog.json`;
      yield* fileSystem.writeFileString(catalogPath, `${catalogJson}\n`);

      yield* Effect.gen(function* () {
        const catalog = yield* DesktopReleaseCatalog.DesktopReleaseCatalog;
        const loaded = yield* catalog.setSource(catalogPath);
        assert.equal(loaded.catalog?.releases[0]?.id, "preview-42");

        const selection = yield* catalog.selectTarget("preview-42");
        assert.isTrue(selection.accepted);
        assert.isTrue(selection.restartRequired);
        assert.equal(selection.state.selectedTargetId, "preview-42");
      }).pipe(Effect.provide(makeLayer(baseDir)));
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
