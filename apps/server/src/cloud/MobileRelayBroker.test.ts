import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";

import * as MobileRelayBroker from "./MobileRelayBroker.ts";

function jwt(input: { readonly sub?: string; readonly exp?: number }): string {
  return [
    Encoding.encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
    Encoding.encodeBase64Url(JSON.stringify(input)),
    "signature",
  ].join(".");
}

describe("MobileRelayBroker", () => {
  it.effect("keeps a fresh desktop Clerk token in memory", () =>
    Effect.gen(function* () {
      const broker = yield* MobileRelayBroker.MobileRelayBroker;
      const now = yield* DateTime.now;
      const clerkToken = jwt({
        sub: "user_glassy",
        exp: Math.floor(now.epochMilliseconds / 1_000) + 60,
      });

      yield* broker.update(clerkToken);

      expect(yield* broker.current).toMatchObject({
        accountId: "user_glassy",
        clerkToken,
      });
    }).pipe(Effect.provide(MobileRelayBroker.layer)),
  );

  it.effect("rejects expired or incomplete desktop tokens", () =>
    Effect.gen(function* () {
      const broker = yield* MobileRelayBroker.MobileRelayBroker;
      const now = yield* DateTime.now;

      expect(
        (yield* Effect.flip(
          broker.update(
            jwt({ sub: "user_glassy", exp: Math.floor(now.epochMilliseconds / 1_000) - 1 }),
          ),
        ))._tag,
      ).toBe("MobileRelayBrokerTokenInvalidError");
      expect((yield* Effect.flip(broker.update(jwt({ exp: 4_000_000_000 }))))._tag).toBe(
        "MobileRelayBrokerTokenInvalidError",
      );
    }).pipe(Effect.provide(MobileRelayBroker.layer)),
  );

  it.effect("clears the session when the desktop signs out", () =>
    Effect.gen(function* () {
      const broker = yield* MobileRelayBroker.MobileRelayBroker;
      const now = yield* DateTime.now;
      yield* broker.update(
        jwt({ sub: "user_glassy", exp: Math.floor(now.epochMilliseconds / 1_000) + 60 }),
      );
      yield* broker.update(null);

      expect((yield* Effect.flip(broker.current))._tag).toBe(
        "MobileRelayBrokerSessionUnavailableError",
      );
    }).pipe(Effect.provide(MobileRelayBroker.layer)),
  );
});
