import type { ReleaseCatalog, ReleaseEntry } from "@t3tools/contracts";

export const DESKTOP_RELEASE_SCHEMA_VERSION = 1;

export interface DesktopReleaseRuntime {
  readonly platform: string;
  readonly appArch: "arm64" | "x64" | "other";
}

export interface ReleaseTargetValidation {
  readonly accepted: boolean;
  readonly error: string | null;
}

export interface ReleaseUpdateVerification {
  readonly accepted: boolean;
  readonly error: string | null;
}

export interface ReleaseSelectionState {
  readonly accepted: boolean;
  readonly selectedTargetId: string | null;
  readonly restartRequired: boolean;
}

export function validateDesktopReleaseTarget(
  entry: ReleaseEntry,
  runtime: DesktopReleaseRuntime,
): ReleaseTargetValidation {
  const schemaVersion = entry.schemaVersion ?? DESKTOP_RELEASE_SCHEMA_VERSION;
  if (schemaVersion !== DESKTOP_RELEASE_SCHEMA_VERSION) {
    return {
      accepted: false,
      error: `Release ${entry.version} uses data schema version ${schemaVersion}; this app supports version ${DESKTOP_RELEASE_SCHEMA_VERSION}. Update to a newer app before selecting it.`,
    };
  }

  if (entry.platform !== "desktop" && entry.platform !== "all") {
    return {
      accepted: false,
      error: `Release ${entry.version} targets the ${entry.platform} platform, not desktop.`,
    };
  }

  if (
    entry.architecture !== undefined &&
    entry.architecture !== "all" &&
    entry.architecture !== runtime.appArch
  ) {
    return {
      accepted: false,
      error: `Release ${entry.version} targets ${entry.architecture}, but this app is ${runtime.appArch}.`,
    };
  }

  if (runtime.appArch === "other") {
    return {
      accepted: false,
      error: "This desktop build has an unsupported architecture for release switching.",
    };
  }

  return { accepted: true, error: null };
}

/**
 * The release workflow archives each channel manifest at this path. An entry
 * can override it when a self-hosted catalog has a different immutable feed.
 */
export function resolveReleaseFeedUrl(input: {
  readonly entry: ReleaseEntry;
  readonly channelFeedUrl: string | null;
}): string | null {
  const explicitFeedUrl = input.entry.updateFeedUrl?.trim();
  if (explicitFeedUrl) return explicitFeedUrl;
  if (!input.channelFeedUrl) return null;

  let feedUrl: URL;
  try {
    feedUrl = new URL(input.channelFeedUrl);
  } catch {
    return null;
  }

  const basePath = feedUrl.pathname.replace(/\/+$/, "");
  feedUrl.pathname = `${basePath}/releases/${encodeURIComponent(input.entry.version)}/`;
  feedUrl.search = "";
  feedUrl.hash = "";
  return feedUrl.toString();
}

export function resolveReleaseUpdaterChannel(
  entry: Pick<ReleaseEntry, "channel">,
): "latest" | "nightly" {
  return entry.channel === "candidate" || entry.channel === "nightly" ? "nightly" : "latest";
}

export function verifyReleaseUpdate(
  entry: Pick<ReleaseEntry, "version" | "commitSha">,
  update: { readonly version: string; readonly commitSha?: string | undefined },
): ReleaseUpdateVerification {
  if (update.version !== entry.version) {
    return {
      accepted: false,
      error: `Downloaded release version ${update.version} does not match selected version ${entry.version}.`,
    };
  }

  if (update.commitSha !== undefined && update.commitSha !== entry.commitSha) {
    return {
      accepted: false,
      error: `Downloaded release commit ${update.commitSha.slice(0, 12)} does not match selected commit ${entry.commitSha.slice(0, 12)}.`,
    };
  }

  return { accepted: true, error: null };
}

/**
 * Select only catalog entries that exist in the decoded catalog. The selected
 * id is persisted separately from the mutable update channel so the updater
 * can resolve it to an immutable feed.
 */
export function selectReleaseTarget(
  catalog: ReleaseCatalog | null,
  targetId: string,
  currentTargetId: string | null,
): ReleaseSelectionState {
  const targetExists = catalog?.releases.some((release) => release.id === targetId) ?? false;
  if (!targetExists) {
    return {
      accepted: false,
      selectedTargetId: currentTargetId,
      restartRequired: currentTargetId !== null,
    };
  }

  return {
    accepted: true,
    selectedTargetId: targetId,
    restartRequired: true,
  };
}
