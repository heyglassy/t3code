import { decodeRelayJwt } from "@t3tools/shared/relayJwt";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

export interface MobileRelayBrokerSession {
  readonly accountId: string;
  readonly clerkToken: string;
  readonly expiresAt: DateTime.Utc;
}

export class MobileRelayBrokerTokenInvalidError extends Schema.TaggedErrorClass<MobileRelayBrokerTokenInvalidError>()(
  "MobileRelayBrokerTokenInvalidError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The desktop T3 Connect token is invalid or expired.";
  }
}

export class MobileRelayBrokerSessionUnavailableError extends Schema.TaggedErrorClass<MobileRelayBrokerSessionUnavailableError>()(
  "MobileRelayBrokerSessionUnavailableError",
  {},
) {
  override get message(): string {
    return "Sign in to T3 Connect on GlassyCode Desktop before connecting the mobile app.";
  }
}

export class MobileRelayBroker extends Context.Service<
  MobileRelayBroker,
  {
    readonly update: (
      clerkToken: string | null,
    ) => Effect.Effect<void, MobileRelayBrokerTokenInvalidError>;
    readonly current: Effect.Effect<
      MobileRelayBrokerSession,
      MobileRelayBrokerSessionUnavailableError
    >;
  }
>()("t3/cloud/MobileRelayBroker") {}

function decodeSession(clerkToken: string) {
  return Effect.gen(function* () {
    const claims = yield* Effect.try({
      try: () => decodeRelayJwt(clerkToken),
      catch: (cause) => new MobileRelayBrokerTokenInvalidError({ cause }),
    });
    if (typeof claims.sub !== "string" || claims.sub.trim() === "" || !claims.exp) {
      return yield* new MobileRelayBrokerTokenInvalidError({ cause: "missing_sub_or_exp" });
    }
    const expiresAt = DateTime.make(claims.exp * 1_000);
    if (Option.isNone(expiresAt)) {
      return yield* new MobileRelayBrokerTokenInvalidError({ cause: "invalid_exp" });
    }
    const now = yield* DateTime.now;
    if (expiresAt.value.epochMilliseconds <= now.epochMilliseconds + 5_000) {
      return yield* new MobileRelayBrokerTokenInvalidError({ cause: "expired" });
    }
    return {
      accountId: claims.sub,
      clerkToken,
      expiresAt: DateTime.toUtc(expiresAt.value),
    } satisfies MobileRelayBrokerSession;
  });
}

export const make = Effect.gen(function* () {
  const session = yield* Ref.make<Option.Option<MobileRelayBrokerSession>>(Option.none());

  return MobileRelayBroker.of({
    update: (clerkToken) =>
      clerkToken === null
        ? Ref.set(session, Option.none())
        : decodeSession(clerkToken).pipe(
            Effect.flatMap((decoded) => Ref.set(session, Option.some(decoded))),
          ),
    current: Effect.gen(function* () {
      const current = yield* Ref.get(session);
      if (Option.isNone(current)) {
        return yield* new MobileRelayBrokerSessionUnavailableError({});
      }
      const now = yield* DateTime.now;
      if (current.value.expiresAt.epochMilliseconds <= now.epochMilliseconds + 5_000) {
        yield* Ref.set(session, Option.none());
        return yield* new MobileRelayBrokerSessionUnavailableError({});
      }
      return current.value;
    }),
  });
});

export const layer = Layer.effect(MobileRelayBroker, make);
