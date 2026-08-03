import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SecureStore from "expo-secure-store";
import { afterEach, vi } from "vite-plus/test";

import {
  configureDesktopRelayBroker,
  readDesktopRelayBrokerClerkToken,
  resolveDesktopRelayBrokerHttpBaseUrl,
} from "./desktopRelayBroker";

const secureStore = vi.hoisted(() => new Map<string, string>());

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: vi.fn((key: string) => {
    secureStore.delete(key);
    return Promise.resolve();
  }),
  getItemAsync: vi.fn((key: string) => Promise.resolve(secureStore.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    secureStore.set(key, value);
    return Promise.resolve();
  }),
}));

afterEach(() => {
  secureStore.clear();
  vi.restoreAllMocks();
});

describe("desktop relay broker", () => {
  it("prefers the discovered managed endpoint for off-LAN renewal", () => {
    const session = {
      version: 1 as const,
      environmentId: EnvironmentId.make("env-desktop"),
      environmentLabel: "Mac Studio",
      httpBaseUrl: "http://192.168.1.2:3773/",
      accountId: "user_glassy",
      accessToken: "broker-access-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };

    expect(
      resolveDesktopRelayBrokerHttpBaseUrl(session, {
        environmentId: EnvironmentId.make("env-desktop"),
        httpBaseUrl: "https://managed.example.test/",
        relayManaged: true,
      }),
    ).toBe("https://managed.example.test/");
  });

  it.effect("persists a device-bound credential and uses DPoP for token renewal", () => {
    const requests: Array<Request> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/credential")) {
        return Response.json({
          accountId: "user_glassy",
          accessToken: "broker-access-token",
          expiresAt: "2030-01-01T00:00:00.000Z",
        });
      }
      return Response.json({
        accountId: "user_glassy",
        clerkToken: "short-lived-clerk-token",
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
    });
    const createProof = vi.fn(
      (input: { readonly method: string; readonly url: string; readonly accessToken?: string }) =>
        Effect.succeed(`proof:${input.method}:${input.accessToken ?? "none"}`),
    );
    const services = Layer.merge(
      remoteHttpClientLayer(fetch),
      Layer.succeed(
        ManagedRelay.ManagedRelayDpopSigner,
        ManagedRelay.ManagedRelayDpopSigner.of({
          thumbprint: Effect.succeed("phone-key-thumbprint"),
          createProof,
        }),
      ),
    );
    const connection = {
      environmentId: EnvironmentId.make("env-desktop"),
      environmentLabel: "Mac Studio",
      pairingUrl: "https://desktop.example.test/",
      displayUrl: "https://desktop.example.test/",
      httpBaseUrl: "https://desktop.example.test/",
      wsBaseUrl: "wss://desktop.example.test/ws",
      bearerToken: "paired-phone-token",
    };

    return Effect.gen(function* () {
      const session = yield* configureDesktopRelayBroker(connection);
      expect(session).toMatchObject({
        accountId: "user_glassy",
        accessToken: "broker-access-token",
        environmentLabel: "Mac Studio",
      });
      expect(SecureStore.setItemAsync).toHaveBeenCalledOnce();

      expect(yield* readDesktopRelayBrokerClerkToken(session)).toBe("short-lived-clerk-token");
      expect(requests).toHaveLength(2);

      const credentialRequest = requests[0]!;
      expect(credentialRequest.headers.get("authorization")).toBe("Bearer paired-phone-token");
      const credentialPayload = yield* Effect.promise(() => credentialRequest.json());
      expect(credentialPayload).toMatchObject({
        proofKeyThumbprint: "phone-key-thumbprint",
        label: "GlassyCode Mobile",
      });

      const tokenRequest = requests[1]!;
      expect(tokenRequest.headers.get("authorization")).toBe("DPoP broker-access-token");
      expect(tokenRequest.headers.get("dpop")).toBe("proof:GET:broker-access-token");
      expect(createProof).toHaveBeenCalledWith({
        method: "GET",
        url: "https://desktop.example.test/api/connect/mobile-relay-broker/token",
        accessToken: "broker-access-token",
      });
    }).pipe(Effect.provide(services));
  });
});
