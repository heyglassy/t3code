import type { ReleaseCatalog } from "@t3tools/contracts";

export interface ReleaseSelectionState {
  readonly accepted: boolean;
  readonly selectedTargetId: string | null;
  readonly restartRequired: boolean;
}

/**
 * Select only catalog entries that exist in the decoded catalog. The selected
 * id is intentionally persisted separately from the mutable update channel so
 * a later updater integration can resolve it to an immutable feed.
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
