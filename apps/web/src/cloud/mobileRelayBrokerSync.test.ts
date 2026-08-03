import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { __setPrimaryHttpRunnerForTests, type PrimaryHttpEffectRunner } from "../lib/runtime";
import { syncMobileRelayBrokerSession } from "./mobileRelayBrokerSync";

afterEach(() => {
  vi.unstubAllGlobals();
  __setPrimaryHttpRunnerForTests();
});

describe("syncMobileRelayBrokerSession", () => {
  it("syncs the fresh relay token through the authenticated desktop client", async () => {
    vi.stubGlobal("window", { desktopBridge: {} });
    let requestCount = 0;
    const runPrimaryHttp: PrimaryHttpEffectRunner = async <A>() => {
      requestCount += 1;
      return undefined as A;
    };
    __setPrimaryHttpRunnerForTests(runPrimaryHttp);

    await syncMobileRelayBrokerSession("clerk-token");

    expect(requestCount).toBe(1);
  });

  it("does nothing in a normal browser", async () => {
    vi.stubGlobal("window", { desktopBridge: undefined });
    let requestCount = 0;
    const runPrimaryHttp: PrimaryHttpEffectRunner = async <A>() => {
      requestCount += 1;
      return undefined as A;
    };
    __setPrimaryHttpRunnerForTests(runPrimaryHttp);

    await syncMobileRelayBrokerSession("clerk-token");

    expect(requestCount).toBe(0);
  });
});
