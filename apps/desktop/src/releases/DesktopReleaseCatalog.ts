import type {
  DesktopReleaseCatalogState,
  DesktopReleaseSelectionResult,
  ReleaseCatalog,
} from "@t3tools/contracts";
import { ReleaseCatalogSchema } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { selectReleaseTarget, validateDesktopReleaseTarget } from "./releaseSelection.ts";

export const DEFAULT_RELEASE_CATALOG_SOURCE =
  "https://raw.githubusercontent.com/heyglassy/t3code/main/release-catalog.json";

export class DesktopReleaseCatalogReadError extends Schema.TaggedErrorClass<DesktopReleaseCatalogReadError>()(
  "DesktopReleaseCatalogReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to read or decode the desktop release catalog.";
  }
}

const ReleaseCatalogPreferencesSchema = Schema.Struct({
  source: Schema.optionalKey(Schema.String),
  selectedTargetId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
type ReleaseCatalogPreferences = typeof ReleaseCatalogPreferencesSchema.Type;

const decodeCatalog = Schema.decodeUnknownEffect(ReleaseCatalogSchema);
const decodePreferencesJson = Schema.decodeEffect(
  Schema.fromJsonString(ReleaseCatalogPreferencesSchema),
);
const encodePreferencesJson = Schema.encodeEffect(
  Schema.fromJsonString(ReleaseCatalogPreferencesSchema),
);
const decodeCatalogJson = Schema.decodeEffect(Schema.fromJsonString(ReleaseCatalogSchema));
const PREFERENCES_FILE_NAME = "release-catalog-settings.json";

export class DesktopReleaseCatalog extends Context.Service<
  DesktopReleaseCatalog,
  {
    readonly get: Effect.Effect<DesktopReleaseCatalogState>;
    readonly setSource: (source: string) => Effect.Effect<DesktopReleaseCatalogState>;
    readonly selectTarget: (targetId: string) => Effect.Effect<DesktopReleaseSelectionResult>;
    readonly clearTarget: Effect.Effect<DesktopReleaseCatalogState>;
  }
>()("@t3tools/desktop/releases/DesktopReleaseCatalog") {}

function readCatalogFromSource(
  source: string,
  fileSystem: FileSystem.FileSystem,
  httpClient: HttpClient.HttpClient,
): Effect.Effect<ReleaseCatalog, DesktopReleaseCatalogReadError, never> {
  let url: URL | null = null;
  try {
    url = new URL(source);
  } catch {
    // A non-URL source is treated as a local filesystem path.
  }

  if (url?.protocol === "http:" || url?.protocol === "https:") {
    return httpClient.execute(HttpClientRequest.get(url.toString())).pipe(
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? response.json.pipe(
              Effect.mapError((cause) => new DesktopReleaseCatalogReadError({ cause })),
            )
          : Effect.fail(
              new DesktopReleaseCatalogReadError({
                cause: { status: response.status },
              }),
            ),
      ),
      Effect.flatMap((value) =>
        decodeCatalog(value).pipe(
          Effect.mapError((cause) => new DesktopReleaseCatalogReadError({ cause })),
        ),
      ),
      Effect.mapError((cause) => new DesktopReleaseCatalogReadError({ cause })),
    );
  }

  const filePath = url?.protocol === "file:" ? decodeURIComponent(url.pathname) : source;
  return fileSystem.readFileString(filePath).pipe(
    Effect.mapError((cause) => new DesktopReleaseCatalogReadError({ cause })),
    Effect.flatMap((raw) =>
      decodeCatalogJson(raw).pipe(
        Effect.mapError((cause) => new DesktopReleaseCatalogReadError({ cause })),
      ),
    ),
  );
}

function preferencesPath(environment: DesktopEnvironment.DesktopEnvironment["Service"]): string {
  return `${environment.stateDir}/${PREFERENCES_FILE_NAME}`;
}

function readPreferences(
  fileSystem: FileSystem.FileSystem,
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
): Effect.Effect<ReleaseCatalogPreferences> {
  return fileSystem.readFileString(preferencesPath(environment)).pipe(
    Effect.flatMap((raw) => decodePreferencesJson(raw)),
    Effect.orElseSucceed(() => ({})),
  );
}

function writePreferences(
  fileSystem: FileSystem.FileSystem,
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  preferences: ReleaseCatalogPreferences,
): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
    const encoded = yield* encodePreferencesJson(preferences);
    yield* fileSystem.writeFileString(preferencesPath(environment), `${encoded}\n`);
  }).pipe(Effect.orDie);
}

export const layer = Layer.effect(
  DesktopReleaseCatalog,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const httpClient = yield* HttpClient.HttpClient;

    const readState = Effect.fn("desktop.releaseCatalog.readState")(function* (
      preferences: ReleaseCatalogPreferences,
    ) {
      const source = preferences.source?.trim() || DEFAULT_RELEASE_CATALOG_SOURCE;
      const catalog = yield* readCatalogFromSource(source, fileSystem, httpClient).pipe(
        Effect.tapError((cause) => Effect.logWarning(cause.message, { cause })),
        Effect.orElseSucceed(() => null),
      );
      const selectedTargetId = preferences.selectedTargetId ?? null;
      const selectedEntry = catalog?.releases.find((release) => release.id === selectedTargetId);
      const compatibilityError = selectedEntry
        ? validateDesktopReleaseTarget(selectedEntry, {
            platform: environment.platform,
            appArch: environment.runtimeInfo.appArch,
          }).error
        : null;
      return {
        source,
        catalog,
        selectedTargetId,
        restartRequired: selectedTargetId !== null,
        error:
          catalog === null
            ? "Could not load the release catalog from the configured source."
            : compatibilityError,
      } satisfies DesktopReleaseCatalogState;
    });

    const get = readPreferences(fileSystem, environment).pipe(Effect.flatMap(readState));

    return DesktopReleaseCatalog.of({
      get,
      setSource: (source) =>
        Effect.gen(function* () {
          const preferences = yield* readPreferences(fileSystem, environment);
          yield* writePreferences(fileSystem, environment, {
            ...preferences,
            source: source.trim(),
          });
          return yield* readState({ ...preferences, source: source.trim() });
        }),
      selectTarget: (targetId) =>
        Effect.gen(function* () {
          const preferences = yield* readPreferences(fileSystem, environment);
          const state = yield* readState(preferences);
          const selection = selectReleaseTarget(state.catalog, targetId, state.selectedTargetId);
          const entry = state.catalog?.releases.find((release) => release.id === targetId);
          const compatibility = entry
            ? validateDesktopReleaseTarget(entry, {
                platform: environment.platform,
                appArch: environment.runtimeInfo.appArch,
              })
            : { accepted: false, error: null };
          const accepted = selection.accepted && compatibility.accepted;
          if (accepted) {
            yield* writePreferences(fileSystem, environment, {
              ...preferences,
              selectedTargetId: selection.selectedTargetId,
            });
          }
          const nextState = {
            ...state,
            selectedTargetId: accepted ? selection.selectedTargetId : state.selectedTargetId,
            restartRequired: accepted ? selection.restartRequired : state.restartRequired,
            error: accepted
              ? null
              : (compatibility.error ??
                `Release target '${targetId}' was not found in the catalog.`),
          } satisfies DesktopReleaseCatalogState;
          return {
            accepted,
            restartRequired: accepted ? selection.restartRequired : state.restartRequired,
            state: nextState,
          } satisfies DesktopReleaseSelectionResult;
        }),
      clearTarget: Effect.gen(function* () {
        const preferences = yield* readPreferences(fileSystem, environment);
        yield* writePreferences(fileSystem, environment, {
          ...preferences,
          selectedTargetId: null,
        });
        return yield* readState({ ...preferences, selectedTargetId: null });
      }),
    });
  }),
);
