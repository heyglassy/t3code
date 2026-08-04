import * as Schema from "effect/Schema";

import { IsoDateTime, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** A release target that can be identified independently of a mutable branch or channel. */
export const ReleaseChannel = Schema.Literals(["stable", "candidate", "nightly", "preview"]);
export type ReleaseChannel = typeof ReleaseChannel.Type;

export const ReleasePlatform = Schema.Literals(["desktop", "mobile", "server", "all"]);
export type ReleasePlatform = typeof ReleasePlatform.Type;

export const ReleaseArchitecture = Schema.Literals(["arm64", "x64", "ios", "android", "all"]);
export type ReleaseArchitecture = typeof ReleaseArchitecture.Type;

const OptionalTrimmedNonEmptyString = Schema.optionalKey(TrimmedNonEmptyString);

export const ReleaseEntrySchema = Schema.Struct({
  id: TrimmedNonEmptyString,
  channel: ReleaseChannel,
  platform: ReleasePlatform,
  version: TrimmedNonEmptyString,
  commitSha: TrimmedNonEmptyString,
  /** Desktop data compatibility version for exact-version installs. */
  schemaVersion: Schema.optionalKey(PositiveInt),
  branch: OptionalTrimmedNonEmptyString,
  prNumber: Schema.optionalKey(PositiveInt),
  prTitle: OptionalTrimmedNonEmptyString,
  prUrl: OptionalTrimmedNonEmptyString,
  buildId: OptionalTrimmedNonEmptyString,
  updateId: OptionalTrimmedNonEmptyString,
  updateFeedUrl: OptionalTrimmedNonEmptyString,
  architecture: Schema.optionalKey(ReleaseArchitecture),
  runtimeFingerprint: OptionalTrimmedNonEmptyString,
  createdAt: Schema.optionalKey(IsoDateTime),
});
export type ReleaseEntry = typeof ReleaseEntrySchema.Type;

export const ReleaseCatalogSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedAt: IsoDateTime,
  releases: Schema.Array(ReleaseEntrySchema),
});
export type ReleaseCatalog = typeof ReleaseCatalogSchema.Type;

export const DesktopReleaseCatalogStateSchema = Schema.Struct({
  source: TrimmedNonEmptyString,
  catalog: Schema.NullOr(ReleaseCatalogSchema),
  selectedTargetId: Schema.NullOr(TrimmedNonEmptyString),
  restartRequired: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
});
export type DesktopReleaseCatalogState = typeof DesktopReleaseCatalogStateSchema.Type;

export const DesktopReleaseSelectionResultSchema = Schema.Struct({
  accepted: Schema.Boolean,
  restartRequired: Schema.Boolean,
  state: DesktopReleaseCatalogStateSchema,
});
export type DesktopReleaseSelectionResult = typeof DesktopReleaseSelectionResultSchema.Type;
