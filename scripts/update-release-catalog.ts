#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";

import {
  ReleaseCatalogSchema,
  ReleaseChannel,
  ReleaseEntrySchema,
  ReleasePlatform,
  type ReleaseCatalog,
  type ReleaseEntry,
} from "@t3tools/contracts";

const CATALOG_FILE_NAME = "release-catalog.json";
const CatalogJsonSchema = fromJsonStringPretty(ReleaseCatalogSchema);
const decodeCatalogJson = Schema.decodeEffect(CatalogJsonSchema);
const encodeCatalogJson = Schema.encodeEffect(CatalogJsonSchema);
const decodeCatalog = Schema.decodeUnknownSync(ReleaseCatalogSchema);
const decodeEntry = Schema.decodeUnknownSync(ReleaseEntrySchema);

export interface ReleaseCatalogEntryInput {
  readonly version: string;
  readonly commitSha: string;
  readonly channel: ReleaseChannel;
  readonly buildId: string;
  readonly updateId: string;
  readonly platform: ReleasePlatform;
  readonly branch: string;
}

export interface UpdateReleaseCatalogOptions extends ReleaseCatalogEntryInput {
  readonly generatedAt: string;
  readonly rootDir?: string | undefined;
  readonly catalogPath?: string | undefined;
}

const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

function compareVersions(left: string, right: string): number {
  const leftMatch = versionPattern.exec(left);
  const rightMatch = versionPattern.exec(right);
  if (!leftMatch || !rightMatch) return right.localeCompare(left);

  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(rightMatch[index]) - Number(leftMatch[index]);
    if (difference !== 0) return difference;
  }

  const leftPrerelease = leftMatch[4]?.split(".") ?? [];
  const rightPrerelease = rightMatch[4]?.split(".") ?? [];
  if (leftPrerelease.length === 0 || rightPrerelease.length === 0) {
    return leftPrerelease.length === rightPrerelease.length
      ? right.localeCompare(left)
      : leftPrerelease.length === 0
        ? -1
        : 1;
  }

  for (let index = 0; index < Math.max(leftPrerelease.length, rightPrerelease.length); index += 1) {
    const leftPart = leftPrerelease[index];
    const rightPart = rightPrerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) {
      return rightNumber - leftNumber;
    }
    if (leftNumber !== undefined || rightNumber !== undefined) {
      return leftNumber !== undefined ? -1 : 1;
    }
    return rightPart.localeCompare(leftPart);
  }
  return right.localeCompare(left);
}

function sortReleasesNewestFirst(releases: ReadonlyArray<ReleaseEntry>): Array<ReleaseEntry> {
  return [...releases].sort((left, right) => {
    const versionOrder = compareVersions(left.version, right.version);
    return versionOrder === 0 ? right.id.localeCompare(left.id) : versionOrder;
  });
}

export function releaseEntryId(
  input: Pick<ReleaseCatalogEntryInput, "channel" | "version" | "commitSha">,
): string {
  return `${input.channel}-${input.version}-${input.commitSha.slice(0, 8)}`;
}

export function appendReleaseToCatalog(
  catalog: ReleaseCatalog,
  input: ReleaseCatalogEntryInput,
  generatedAt: string,
): ReleaseCatalog {
  const decodedCatalog = decodeCatalog(catalog);
  const entry = decodeEntry({
    id: releaseEntryId(input),
    channel: input.channel,
    platform: input.platform,
    version: input.version,
    commitSha: input.commitSha,
    branch: input.branch,
    buildId: input.buildId,
    updateId: input.updateId,
  });
  return decodeCatalog({
    schemaVersion: decodedCatalog.schemaVersion,
    generatedAt,
    releases: sortReleasesNewestFirst([
      ...decodedCatalog.releases.filter((release) => release.id !== entry.id),
      entry,
    ]),
  });
}

export const updateReleaseCatalog = Effect.fn("updateReleaseCatalog")(function* (
  options: UpdateReleaseCatalogOptions,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const catalogPath = path.resolve(rootDir, options.catalogPath ?? CATALOG_FILE_NAME);
  const source = yield* fileSystem.readFileString(catalogPath);
  const catalog = yield* decodeCatalogJson(source);
  const nextCatalog = appendReleaseToCatalog(catalog, options, options.generatedAt);
  const encoded = yield* encodeCatalogJson(nextCatalog);
  yield* fileSystem.writeFileString(catalogPath, `${encoded}\n`);
  return { catalog: nextCatalog, catalogPath };
});

const command = Command.make(
  "update-release-catalog",
  {
    version: Flag.string("version"),
    commitSha: Flag.string("commit-sha"),
    channel: Flag.choice("channel", ["stable", "candidate", "nightly", "preview"] as const),
    buildId: Flag.string("build-id"),
    updateId: Flag.string("update-id"),
    platform: Flag.choice("platform", ["desktop", "mobile", "server", "all"] as const),
    branch: Flag.string("branch"),
    generatedAt: Flag.string("generated-at"),
    root: Flag.string("root").pipe(Flag.optional),
    catalog: Flag.string("catalog").pipe(Flag.optional),
  },
  ({
    version,
    commitSha,
    channel,
    buildId,
    updateId,
    platform,
    branch,
    generatedAt,
    root,
    catalog,
  }) =>
    updateReleaseCatalog({
      version,
      commitSha,
      channel,
      buildId,
      updateId,
      platform,
      branch,
      generatedAt,
      rootDir: Option.getOrUndefined(root),
      catalogPath: Option.getOrUndefined(catalog),
    }).pipe(Effect.tap(({ catalogPath }) => Console.log(`Updated ${catalogPath}.`))),
).pipe(Command.withDescription("Append a shipped release to release-catalog.json."));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
