import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { ReleaseCatalogSchema, type ReleaseCatalog } from "@t3tools/contracts";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";

import {
  appendReleaseToCatalog,
  releaseEntryId,
  updateReleaseCatalog,
} from "./update-release-catalog.ts";

const TestLayer = NodeServices.layer;
const CatalogJsonSchema = fromJsonStringPretty(ReleaseCatalogSchema);
const encodeCatalogJson = Schema.encodeSync(CatalogJsonSchema);
const decodeCatalogJson = Schema.decodeEffect(CatalogJsonSchema);
const decodeCatalog = Schema.decodeUnknownSync(ReleaseCatalogSchema);
const generatedAt = "2026-08-04T02:20:49.000Z";
const baseCatalog: ReleaseCatalog = {
  schemaVersion: 1,
  generatedAt: "2026-08-03T00:00:00.000Z",
  releases: [
    {
      id: "stable-0.0.31-8d381767",
      channel: "stable",
      platform: "desktop",
      version: "0.0.31",
      commitSha: "8d381767487785016e54280759d5326f2dabb760",
      schemaVersion: 1,
      architecture: "arm64",
      branch: "main",
      buildId: "desktop-0.0.31",
      updateId: "stable-0.0.31",
    },
  ],
};

const nightlyInput = {
  version: "0.0.32-nightly.20260803.3",
  commitSha: "034c0a6e3d9a630e897ef2180f67b85d0a49c8a2",
  channel: "nightly" as const,
  platform: "desktop" as const,
  architecture: "arm64" as const,
  branch: "main",
  buildId: "desktop-0.0.32-nightly.20260803.3",
  updateId: "nightly-0.0.32-nightly.20260803.3",
};

describe("appendReleaseToCatalog", () => {
  it("adds a validated entry, refreshes the timestamp, and sorts newest-first", () => {
    const catalog = appendReleaseToCatalog(baseCatalog, nightlyInput, generatedAt);

    assert.equal(catalog.generatedAt, generatedAt);
    assert.deepStrictEqual(
      catalog.releases.map(({ version }) => version),
      ["0.0.32-nightly.20260803.3", "0.0.31"],
    );
    assert.deepStrictEqual(catalog.releases[0], {
      id: releaseEntryId(nightlyInput),
      schemaVersion: 1,
      ...nightlyInput,
    });
    decodeCatalog(catalog);
  });

  it("deduplicates an existing id while keeping the new metadata", () => {
    const first = appendReleaseToCatalog(baseCatalog, nightlyInput, generatedAt);
    const updated = appendReleaseToCatalog(
      first,
      { ...nightlyInput, buildId: "desktop-rebuilt" },
      "2026-08-04T03:00:00.000Z",
    );

    assert.equal(updated.releases.length, 2);
    assert.equal(updated.releases[0]?.buildId, "desktop-rebuilt");
    assert.equal(updated.generatedAt, "2026-08-04T03:00:00.000Z");
  });

  it("rejects values that do not satisfy the release entry schema", () => {
    assert.throws(() =>
      appendReleaseToCatalog(
        baseCatalog,
        { ...nightlyInput, channel: "unsupported" as never },
        generatedAt,
      ),
    );
  });
});

it.layer(TestLayer)("updateReleaseCatalog", (it) => {
  it.effect("reads, updates, validates, and writes the catalog file", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const rootDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "update-release-catalog-",
      });
      const catalogPath = `${rootDir}/catalog.json`;
      yield* fileSystem.writeFileString(catalogPath, `${encodeCatalogJson(baseCatalog)}\n`);

      const result = yield* updateReleaseCatalog({
        ...nightlyInput,
        generatedAt,
        rootDir,
        catalogPath: "catalog.json",
      });
      const written = yield* fileSystem.readFileString(catalogPath);
      const decoded = yield* decodeCatalogJson(written);

      assert.equal(result.catalogPath, catalogPath);
      assert.equal(decoded.generatedAt, generatedAt);
      assert.equal(decoded.releases.length, 2);
    }),
  );
});
