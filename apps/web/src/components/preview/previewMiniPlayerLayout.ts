import type { PreviewMiniPlayerPosition, PreviewMiniPlayerSize } from "~/previewMiniPlayerStore";

export const PREVIEW_MINI_PLAYER_EDGE_GAP = 12;
export const PREVIEW_MINI_PLAYER_SNAP_THRESHOLD = 24;
export const PREVIEW_MINI_PLAYER_DEFAULT_SIZE = { width: 320, height: 200 } as const;
export const PREVIEW_MINI_PLAYER_MIN_SIZE = { width: 240, height: 150 } as const;

function previewMiniPlayerPositionBounds(
  container: PreviewMiniPlayerSize,
  player: PreviewMiniPlayerSize,
  bottomInset: number,
) {
  const reservedBottomSpace = Math.max(0, bottomInset);
  return {
    minX: PREVIEW_MINI_PLAYER_EDGE_GAP,
    maxX: Math.max(
      PREVIEW_MINI_PLAYER_EDGE_GAP,
      container.width - player.width - PREVIEW_MINI_PLAYER_EDGE_GAP,
    ),
    minY: PREVIEW_MINI_PLAYER_EDGE_GAP,
    maxY: Math.max(
      PREVIEW_MINI_PLAYER_EDGE_GAP,
      container.height - reservedBottomSpace - player.height - PREVIEW_MINI_PLAYER_EDGE_GAP,
    ),
  };
}

export function clampPreviewMiniPlayerSize(
  size: PreviewMiniPlayerSize,
  container: PreviewMiniPlayerSize,
  bottomInset = 0,
): PreviewMiniPlayerSize {
  const availableWidth = Math.max(1, container.width - PREVIEW_MINI_PLAYER_EDGE_GAP * 2);
  const availableHeight = Math.max(
    1,
    container.height - Math.max(0, bottomInset) - PREVIEW_MINI_PLAYER_EDGE_GAP * 2,
  );
  return {
    width: Math.round(
      Math.min(Math.max(PREVIEW_MINI_PLAYER_MIN_SIZE.width, size.width), availableWidth),
    ),
    height: Math.round(
      Math.min(Math.max(PREVIEW_MINI_PLAYER_MIN_SIZE.height, size.height), availableHeight),
    ),
  };
}

export function clampPreviewMiniPlayerPosition(
  position: PreviewMiniPlayerPosition,
  container: PreviewMiniPlayerSize,
  player: PreviewMiniPlayerSize,
  bottomInset = 0,
): PreviewMiniPlayerPosition {
  const bounds = previewMiniPlayerPositionBounds(container, player, bottomInset);
  return {
    x: Math.min(Math.max(position.x, bounds.minX), bounds.maxX),
    y: Math.min(Math.max(position.y, bounds.minY), bounds.maxY),
  };
}

export function snapPreviewMiniPlayerPosition(
  position: PreviewMiniPlayerPosition,
  container: PreviewMiniPlayerSize,
  player: PreviewMiniPlayerSize,
  bottomInset = 0,
): PreviewMiniPlayerPosition {
  const bounds = previewMiniPlayerPositionBounds(container, player, bottomInset);
  const clamped = clampPreviewMiniPlayerPosition(position, container, player, bottomInset);
  return {
    x:
      Math.abs(clamped.x - bounds.minX) <= PREVIEW_MINI_PLAYER_SNAP_THRESHOLD
        ? bounds.minX
        : Math.abs(clamped.x - bounds.maxX) <= PREVIEW_MINI_PLAYER_SNAP_THRESHOLD
          ? bounds.maxX
          : clamped.x,
    y:
      Math.abs(clamped.y - bounds.minY) <= PREVIEW_MINI_PLAYER_SNAP_THRESHOLD
        ? bounds.minY
        : Math.abs(clamped.y - bounds.maxY) <= PREVIEW_MINI_PLAYER_SNAP_THRESHOLD
          ? bounds.maxY
          : clamped.y,
  };
}
