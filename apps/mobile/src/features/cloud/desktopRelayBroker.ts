import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { makeEnvironmentHttpApiClient } from "@t3tools/client-runtime/rpc";
import { EnvironmentId } from "@t3tools/contracts";
import type { SavedRemoteConnection } from "../../lib/connection";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SecureStore from "expo-secure-store";
import { useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "glassycode.cloud.desktop-relay-broker";
const BROKER_TOKEN_PATH = "/api/connect/mobile-relay-broker/token";

const DesktopRelayBrokerSessionSchema = Schema.Struct({
  version: Schema.Literal(1),
  environmentId: EnvironmentId,
  environmentLabel: Schema.String,
  httpBaseUrl: Schema.String,
  accountId: Schema.String,
  accessToken: Schema.String,
  expiresAt: Schema.String,
});
const DesktopRelayBrokerSessionJson = Schema.fromJsonString(DesktopRelayBrokerSessionSchema);
export type DesktopRelayBrokerSession = typeof DesktopRelayBrokerSessionSchema.Type;

const decodeSession = Schema.decodeUnknownEffect(DesktopRelayBrokerSessionJson);
const encodeSession = Schema.encodeEffect(DesktopRelayBrokerSessionJson);

export class DesktopRelayBrokerError extends Schema.TaggedErrorClass<DesktopRelayBrokerError>()(
  "DesktopRelayBrokerError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

let currentSession: DesktopRelayBrokerSession | null | undefined;
let loadPromise: Promise<DesktopRelayBrokerSession | null> | null = null;
const listeners = new Set<() => void>();

function publish(session: DesktopRelayBrokerSession | null): DesktopRelayBrokerSession | null {
  currentSession = session;
  for (const listener of listeners) listener();
  return session;
}

function isExpired(session: DesktopRelayBrokerSession): boolean {
  const expiresAt = Date.parse(session.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 5_000;
}

export async function loadDesktopRelayBrokerSession(): Promise<DesktopRelayBrokerSession | null> {
  if (currentSession !== undefined) return currentSession;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const encoded = await SecureStore.getItemAsync(STORAGE_KEY);
    if (encoded === null) return publish(null);
    try {
      const session = await Effect.runPromise(decodeSession(encoded));
      if (isExpired(session)) {
        await SecureStore.deleteItemAsync(STORAGE_KEY);
        return publish(null);
      }
      return publish(session);
    } catch {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
      return publish(null);
    }
  })().finally(() => {
    loadPromise = null;
  });
  return loadPromise;
}

export function useDesktopRelayBrokerSession(): DesktopRelayBrokerSession | null | undefined {
  const session = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentSession,
    () => undefined,
  );

  useEffect(() => {
    if (session === undefined && loadPromise === null) {
      void loadDesktopRelayBrokerSession();
    }
  }, [session]);
  return session;
}

export function resolveDesktopRelayBrokerHttpBaseUrl(
  session: DesktopRelayBrokerSession,
  connection?: Pick<SavedRemoteConnection, "environmentId" | "httpBaseUrl" | "relayManaged">,
): string {
  return connection?.environmentId === session.environmentId && connection.relayManaged
    ? connection.httpBaseUrl
    : session.httpBaseUrl;
}

export const configureDesktopRelayBroker = Effect.fn("mobile.desktopRelayBroker.configure")(
  function* (connection: SavedRemoteConnection) {
    if (!connection.bearerToken) {
      return yield* new DesktopRelayBrokerError({
        message: "Connect directly to this desktop before using its T3 Connect account.",
      });
    }
    const signer = yield* ManagedRelay.ManagedRelayDpopSigner;
    const thumbprint = yield* signer.thumbprint.pipe(
      Effect.mapError(
        (cause) =>
          new DesktopRelayBrokerError({
            message: "Could not load the GlassyCode Mobile device key.",
            cause,
          }),
      ),
    );
    const client = yield* makeEnvironmentHttpApiClient(connection.httpBaseUrl);
    const issued = yield* client.connect
      .issueMobileRelayBrokerCredential({
        headers: { authorization: `Bearer ${connection.bearerToken}` },
        payload: {
          proofKeyThumbprint: thumbprint,
          label: "GlassyCode Mobile",
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new DesktopRelayBrokerError({
              message:
                "The desktop could not authorize GlassyCode Mobile. Make sure GlassyCode Desktop is open and signed in to T3 Connect.",
              cause,
            }),
        ),
      );
    const session: DesktopRelayBrokerSession = {
      version: 1,
      environmentId: connection.environmentId,
      environmentLabel: connection.environmentLabel,
      httpBaseUrl: connection.httpBaseUrl,
      accountId: issued.accountId,
      accessToken: issued.accessToken,
      expiresAt: DateTime.formatIso(issued.expiresAt),
    };
    const encoded = yield* encodeSession(session).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopRelayBrokerError({
            message: "Could not encode the desktop sign-in credential.",
            cause,
          }),
      ),
    );
    yield* Effect.tryPromise({
      try: () => SecureStore.setItemAsync(STORAGE_KEY, encoded),
      catch: (cause) =>
        new DesktopRelayBrokerError({
          message: "Could not securely save the desktop sign-in credential.",
          cause,
        }),
    });
    yield* Effect.sync(() => publish(session));
    return session;
  },
);

export const readDesktopRelayBrokerClerkToken = Effect.fn(
  "mobile.desktopRelayBroker.readClerkToken",
)(function* (session: DesktopRelayBrokerSession, httpBaseUrl = session.httpBaseUrl) {
  const signer = yield* ManagedRelay.ManagedRelayDpopSigner;
  const targetUrl = new URL(BROKER_TOKEN_PATH, httpBaseUrl).toString();
  const proof = yield* signer
    .createProof({ method: "GET", url: targetUrl, accessToken: session.accessToken })
    .pipe(
      Effect.mapError(
        (cause) =>
          new DesktopRelayBrokerError({
            message: "Could not prove this phone's desktop authorization.",
            cause,
          }),
      ),
    );
  const client = yield* makeEnvironmentHttpApiClient(httpBaseUrl);
  const result = yield* client.connect
    .mobileRelayBrokerToken({
      headers: {
        authorization: `DPoP ${session.accessToken}`,
        dpop: proof,
      },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new DesktopRelayBrokerError({
            message:
              "Could not refresh T3 Connect through GlassyCode Desktop. Make sure the desktop is open and signed in.",
            cause,
          }),
      ),
    );
  if (result.accountId !== session.accountId) {
    return yield* new DesktopRelayBrokerError({
      message: "The desktop is signed in to a different T3 Connect account.",
    });
  }
  return result.clerkToken;
});

export const clearDesktopRelayBrokerSession = Effect.fn("mobile.desktopRelayBroker.clear")(
  function* () {
    yield* Effect.tryPromise({
      try: () => SecureStore.deleteItemAsync(STORAGE_KEY),
      catch: (cause) =>
        new DesktopRelayBrokerError({
          message: "Could not remove the desktop sign-in credential.",
          cause,
        }),
    });
    yield* Effect.sync(() => publish(null));
  },
);
