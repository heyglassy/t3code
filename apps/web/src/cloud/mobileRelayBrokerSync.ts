import * as Effect from "effect/Effect";

import { PrimaryEnvironmentHttpClient } from "../environments/primary/httpClient";
import { runPrimaryHttp } from "../lib/runtime";

export async function syncMobileRelayBrokerSession(clerkToken: string | null): Promise<void> {
  if (typeof window === "undefined" || !window.desktopBridge) return;

  await runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) =>
        client.connect.syncMobileRelayBrokerSession({
          headers: {},
          payload: { clerkToken },
        }),
      ),
      Effect.asVoid,
    ),
  );
}
