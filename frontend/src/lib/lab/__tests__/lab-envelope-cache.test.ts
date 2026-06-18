// Tests for lib/lab/lab-envelope-cache.ts
//
// The cache is a thin wrapper over user-settings (patchUserSettings /
// readUserSettings), so user-settings is mocked and we assert the pass-through:
// save writes the field, read returns it, clear writes undefined. The real
// security guarantee (no lab key stored) is enforced by the caller in
// lab-session-effects.ts and verified there.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/settings/user-settings", () => ({
  patchUserSettings: vi.fn().mockResolvedValue(undefined),
  readUserSettings: vi.fn(),
}));

import {
  saveLabEnvelopeCache,
  readLabEnvelopeCache,
  clearLabEnvelopeCache,
  type CachedLabEnvelope,
} from "../lab-envelope-cache";
import {
  patchUserSettings,
  readUserSettings,
} from "@/lib/settings/user-settings";

const USERNAME = "alice";

function makeCached(): CachedLabEnvelope {
  return {
    labId: "lab-xyz",
    record: { labId: "lab-xyz" } as never,
    envelope: { generation: 2, copies: [] } as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lab-envelope-cache", () => {
  it("saveLabEnvelopeCache patches user settings with lab_envelope_cache", async () => {
    const cached = makeCached();
    await saveLabEnvelopeCache(USERNAME, cached);
    expect(patchUserSettings).toHaveBeenCalledWith(USERNAME, {
      lab_envelope_cache: cached,
    });
  });

  it("readLabEnvelopeCache returns the stored cache", async () => {
    const cached = makeCached();
    vi.mocked(readUserSettings).mockResolvedValueOnce({
      lab_envelope_cache: cached,
    } as never);
    await expect(readLabEnvelopeCache(USERNAME)).resolves.toEqual(cached);
  });

  it("readLabEnvelopeCache returns null when no cache is stored", async () => {
    vi.mocked(readUserSettings).mockResolvedValueOnce({} as never);
    await expect(readLabEnvelopeCache(USERNAME)).resolves.toBeNull();
  });

  it("clearLabEnvelopeCache writes undefined so the field drops from disk", async () => {
    await clearLabEnvelopeCache(USERNAME);
    expect(patchUserSettings).toHaveBeenCalledWith(USERNAME, {
      lab_envelope_cache: undefined,
    });
  });
});
