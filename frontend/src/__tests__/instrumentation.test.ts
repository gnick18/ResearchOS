// Server-init seed-runner wiring tests (demo-lab-network Phase 3, social lane).
//
// Verifies the four guards on register() in src/instrumentation.ts WITHOUT a real
// Neon / R2 / fs: the flag helper and the seedDemoLab module are both mocked, so
// nothing touches persistence.
//
//   1. Flag ON  + nodejs runtime -> seedDemoLab() is invoked once.
//   2. Flag OFF                  -> seedDemoLab() is never invoked (complete no-op).
//   3. Non-nodejs runtime        -> seedDemoLab() is never invoked (server-only).
//   4. seedDemoLab throws        -> register() resolves (fail soft, no boot crash).
//   5. Re-invocation in-process  -> seedDemoLab() runs at most once (latch).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isLabSitesEnabled = vi.fn();
const seedDemoLab = vi.fn();

vi.mock("@/lib/social/config", () => ({
  isLabSitesEnabled: () => isLabSitesEnabled(),
}));
vi.mock("@/lib/social/seed-demo-lab", () => ({
  seedDemoLab: (...args: unknown[]) => seedDemoLab(...args),
}));

// Each test re-imports a fresh copy of the module so its once-per-process latch
// is reset (resetModules clears the instrumentation module; the vi.mock factories
// above persist across the reset).
async function loadRegister() {
  vi.resetModules();
  const mod = await import("../instrumentation");
  return mod.register;
}

const SEED_RESULT = {
  slug: "fakeyeast-lab",
  slugReserved: "already" as const,
  siteOk: true,
  pagesPublished: 3,
  byoFilesUploaded: 2,
  byoTotalBytes: 1234,
  byoManifestStored: true,
};

describe("instrumentation register() seed wiring", () => {
  const originalRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    process.env.NEXT_RUNTIME = "nodejs";
    seedDemoLab.mockResolvedValue(SEED_RESULT);
  });
  afterEach(() => {
    vi.clearAllMocks();
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
  });

  it("runs seedDemoLab when the flag is ON in the nodejs runtime", async () => {
    isLabSitesEnabled.mockReturnValue(true);
    const register = await loadRegister();
    await register();
    expect(seedDemoLab).toHaveBeenCalledTimes(1);
  });

  it("is a complete no-op when the flag is OFF", async () => {
    isLabSitesEnabled.mockReturnValue(false);
    const register = await loadRegister();
    await register();
    expect(seedDemoLab).not.toHaveBeenCalled();
  });

  it("does not run outside the nodejs runtime (server-only)", async () => {
    process.env.NEXT_RUNTIME = "edge";
    isLabSitesEnabled.mockReturnValue(true);
    const register = await loadRegister();
    await register();
    expect(isLabSitesEnabled).not.toHaveBeenCalled();
    expect(seedDemoLab).not.toHaveBeenCalled();
  });

  it("fails soft when the seed throws (boot is not aborted)", async () => {
    isLabSitesEnabled.mockReturnValue(true);
    seedDemoLab.mockRejectedValue(new Error("transient DB"));
    const register = await loadRegister();
    await expect(register()).resolves.toBeUndefined();
    expect(seedDemoLab).toHaveBeenCalledTimes(1);
  });

  it("seeds at most once per process (latch)", async () => {
    isLabSitesEnabled.mockReturnValue(true);
    const register = await loadRegister();
    await register();
    await register();
    expect(seedDemoLab).toHaveBeenCalledTimes(1);
  });
});
