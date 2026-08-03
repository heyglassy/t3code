import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { ManagedRelay, setManagedRelaySession } from "@t3tools/client-runtime/relay";
import {
  reportAtomCommandResult,
  settleAsyncResult,
  settlePromise,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

import { environmentCatalog } from "../../connection/catalog";
import { runtime } from "../../lib/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import {
  releaseAgentAwarenessRelayTokenProvider,
  setAgentAwarenessRelayTokenProvider,
  unregisterAgentAwarenessDeviceForCurrentUser,
} from "../agent-awareness/remoteRegistration";
import { clearConnectOnboardingRequest, requestConnectOnboarding } from "./connectOnboarding";
import { resolveCloudPublicConfig, resolveRelayClerkTokenOptions } from "./publicConfig";
import {
  readDesktopRelayBrokerClerkToken,
  resolveDesktopRelayBrokerHttpBaseUrl,
  useDesktopRelayBrokerSession,
} from "./desktopRelayBroker";

let activeCloudRelayTokenProvider: (() => Promise<string | null>) | null = null;

export function readActiveCloudRelayToken(): Promise<string | null> {
  return activeCloudRelayTokenProvider?.() ?? Promise.resolve(null);
}

function resetManagedRelayTokenCache() {
  return settleAsyncResult(() =>
    runtime.runPromiseExit(
      ManagedRelay.ManagedRelayClient.pipe(Effect.flatMap((client) => client.resetTokenCache)),
    ),
  );
}

export function deactivateCloudRelayAccount(): void {
  activeCloudRelayTokenProvider = null;
  setAgentAwarenessRelayTokenProvider(null);
  setManagedRelaySession(appAtomRegistry, null);
}

export function activateCloudRelayAccount(
  accountId: string,
  tokenProvider: () => Promise<string | null>,
): void {
  activeCloudRelayTokenProvider = tokenProvider;
  setAgentAwarenessRelayTokenProvider(tokenProvider, accountId);
  setManagedRelaySession(appAtomRegistry, {
    accountId,
    readClerkToken: tokenProvider,
  });
}

function CloudAuthBridge(props: { readonly children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const removeRelayEnvironments = useAtomCommand(environmentCatalog.removeRelayEnvironments, {
    reportFailure: false,
    reportDefect: false,
  });
  const previousTokenProviderRef = useRef<{
    readonly userId: string;
    readonly provider: () => Promise<string | null>;
  } | null>(null);
  const observedAccountRef = useRef<string | null | undefined>(undefined);
  const accountTransitionRef = useRef<Promise<void> | null>(null);
  const desktopBrokerSession = useDesktopRelayBrokerSession();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const brokerConnection = desktopBrokerSession
    ? savedConnectionsById[desktopBrokerSession.environmentId]
    : undefined;
  const brokerHttpBaseUrl = desktopBrokerSession
    ? resolveDesktopRelayBrokerHttpBaseUrl(desktopBrokerSession, brokerConnection)
    : undefined;
  const desktopBrokerTokenProvider = useCallback(
    () =>
      desktopBrokerSession && brokerHttpBaseUrl
        ? runtime.runPromise(
            readDesktopRelayBrokerClerkToken(desktopBrokerSession, brokerHttpBaseUrl),
          )
        : Promise.resolve(null),
    [brokerHttpBaseUrl, desktopBrokerSession],
  );

  useEffect(() => {
    let cancelled = false;
    if (!isLoaded || desktopBrokerSession === undefined) {
      return;
    }

    const previousObservedAccount = observedAccountRef.current;
    const activeSession =
      isSignedIn && userId
        ? {
            accountId: userId,
            provider: () => getToken(resolveRelayClerkTokenOptions()),
          }
        : desktopBrokerSession
          ? {
              accountId: desktopBrokerSession.accountId,
              provider: desktopBrokerTokenProvider,
            }
          : null;
    const nextAccount = activeSession?.accountId ?? null;
    observedAccountRef.current = nextAccount;

    // Every sign-in or account switch that completes during this session (a
    // cold start observes undefined → account and must not re-prompt) requests
    // the T3 Connect onboarding sheet — account transitions clear the
    // connected environments, so each new session starts with no devices to
    // reach. The request itself is issued after the cleanup transition inside
    // activateSession, so the sheet never lists the previous account's
    // environments; sign-out drops any not-yet-presented request instead.
    const isAccountTransition =
      previousObservedAccount !== undefined && previousObservedAccount !== nextAccount;
    if (isAccountTransition && nextAccount === null) {
      clearConnectOnboardingRequest();
    }

    const queueAccountCleanup = (
      previous: {
        readonly userId: string;
        readonly provider: () => Promise<string | null>;
      } | null,
    ) => {
      const previousTransition = accountTransitionRef.current ?? Promise.resolve();
      accountTransitionRef.current = previousTransition.then(async () => {
        const cleanup = [
          resetManagedRelayTokenCache(),
          removeRelayEnvironments(),
          ...(previous
            ? [
                settleAsyncResult(() =>
                  runtime.runPromiseExit(
                    unregisterAgentAwarenessDeviceForCurrentUser(previous.provider),
                  ),
                ),
              ]
            : []),
        ];
        const results = await Promise.all(cleanup);
        for (const result of results) {
          reportAtomCommandResult(result, { label: "cloud account cleanup" });
        }
      });
      return accountTransitionRef.current;
    };

    if (!activeSession) {
      const previous = previousTokenProviderRef.current;
      previousTokenProviderRef.current = null;
      deactivateCloudRelayAccount();
      if (previousObservedAccount !== null) {
        void queueAccountCleanup(previous);
      }
      return;
    }

    const previous = previousTokenProviderRef.current;
    const tokenProvider = activeSession.provider;
    const accountId = activeSession.accountId;
    const activateSession = () => {
      if (cancelled) {
        return;
      }
      previousTokenProviderRef.current = { userId: accountId, provider: tokenProvider };
      activateCloudRelayAccount(accountId, tokenProvider);
      if (isAccountTransition) {
        requestConnectOnboarding(accountId);
      }
    };
    const activateAfterTransition = (transition: Promise<void>) => {
      void (async () => {
        const result = await settlePromise(async () => {
          await transition;
          activateSession();
        });
        reportAtomCommandResult(result, { label: "cloud account activation" });
      })();
    };
    if (
      previousObservedAccount !== undefined &&
      previousObservedAccount !== null &&
      previousObservedAccount !== accountId
    ) {
      previousTokenProviderRef.current = null;
      deactivateCloudRelayAccount();
      activateAfterTransition(queueAccountCleanup(previous));
    } else {
      activateAfterTransition(accountTransitionRef.current ?? Promise.resolve());
    }

    return () => {
      cancelled = true;
    };
  }, [
    desktopBrokerSession,
    desktopBrokerTokenProvider,
    getToken,
    isLoaded,
    isSignedIn,
    removeRelayEnvironments,
    userId,
  ]);

  useEffect(
    () => () => {
      previousTokenProviderRef.current = null;
      // Unmounting is not a sign-out: the user is usually still signed in, so
      // detach the provider without ending lock-screen activities or wiping the
      // persisted registration (a remount reuses both).
      releaseAgentAwarenessRelayTokenProvider();
      setManagedRelaySession(appAtomRegistry, null);
    },
    [],
  );

  return props.children;
}

export function CloudAuthProvider(props: { readonly children: ReactNode }) {
  const config = resolveCloudPublicConfig();
  const publishableKey = config.clerk.publishableKey;
  const relayUrl = config.relay.url;

  useEffect(() => {
    if (!publishableKey || !relayUrl) {
      deactivateCloudRelayAccount();
    }
  }, [publishableKey, relayUrl]);

  if (!publishableKey || !relayUrl) {
    return props.children;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <CloudAuthBridge>{props.children}</CloudAuthBridge>
    </ClerkProvider>
  );
}
