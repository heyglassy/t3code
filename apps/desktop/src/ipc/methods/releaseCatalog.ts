import {
  DesktopReleaseCatalogStateSchema,
  DesktopReleaseSelectionResultSchema,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopReleaseCatalog from "../../releases/DesktopReleaseCatalog.ts";
import * as DesktopUpdates from "../../updates/DesktopUpdates.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getReleaseCatalog = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.RELEASE_CATALOG_GET_CHANNEL,
  payload: Schema.Void,
  result: DesktopReleaseCatalogStateSchema,
  handler: Effect.fn("desktop.ipc.releaseCatalog.get")(function* () {
    const catalog = yield* DesktopReleaseCatalog.DesktopReleaseCatalog;
    return yield* catalog.get;
  }),
});

export const setReleaseCatalogSource = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.RELEASE_CATALOG_SET_SOURCE_CHANNEL,
  payload: TrimmedNonEmptyString,
  result: DesktopReleaseCatalogStateSchema,
  handler: Effect.fn("desktop.ipc.releaseCatalog.setSource")(function* (source) {
    const catalog = yield* DesktopReleaseCatalog.DesktopReleaseCatalog;
    return yield* catalog.setSource(source);
  }),
});

export const selectReleaseTarget = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.RELEASE_CATALOG_SELECT_TARGET_CHANNEL,
  payload: TrimmedNonEmptyString,
  result: DesktopReleaseSelectionResultSchema,
  handler: Effect.fn("desktop.ipc.releaseCatalog.selectTarget")(function* (targetId) {
    const catalog = yield* DesktopReleaseCatalog.DesktopReleaseCatalog;
    const updates = yield* DesktopUpdates.DesktopUpdates;
    const currentState = yield* catalog.get;
    const entry = currentState.catalog?.releases.find((release) => release.id === targetId);
    if (entry) {
      const preparation = yield* updates.selectReleaseTarget(entry);
      if (!preparation.accepted) {
        return {
          accepted: false,
          restartRequired: currentState.restartRequired,
          state: {
            ...currentState,
            error: preparation.error,
          },
        };
      }
    }
    return yield* catalog.selectTarget(targetId);
  }),
});

export const followReleaseChannel = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.RELEASE_CATALOG_FOLLOW_CHANNEL,
  payload: Schema.Void,
  result: DesktopReleaseCatalogStateSchema,
  handler: Effect.fn("desktop.ipc.releaseCatalog.followChannel")(function* () {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    const catalog = yield* DesktopReleaseCatalog.DesktopReleaseCatalog;
    const result = yield* updates.followReleaseChannel;
    if (!result.accepted) {
      const currentState = yield* catalog.get;
      return { ...currentState, error: result.error };
    }
    return yield* catalog.clearTarget;
  }),
});
