// Tests for the recovery decision function — pinned by the security
// manager's APPROVE constraints [8] (validate-before-offer) and [10]
// (offline-mode interaction).

import { describe, expect, it, vi } from "vitest";
import { decideRecovery } from "../telegram-recovery";
import { TelegramApiError, type TelegramBotInfo } from "../telegram-client";
import type { CachedTelegramToken } from "../telegram-token-cache";

const CACHED: CachedTelegramToken = {
  botToken: "111:aaa",
  chatId: 1001,
  botUsername: "alice_bot",
};

const BOT_INFO: TelegramBotInfo = {
  id: 111,
  is_bot: true,
  username: "alice_bot",
  first_name: "Alice Bot",
};

function getMeOk() {
  return vi.fn(async () => BOT_INFO);
}

function getMeThrowing(err: unknown) {
  return vi.fn(async () => {
    throw err;
  });
}

describe("decideRecovery — no cache", () => {
  it("returns { kind: 'none' } when there's no cached entry", async () => {
    const decision = await decideRecovery({
      cached: null,
      offlineMode: false,
      getMe: getMeOk(),
    });
    expect(decision).toEqual({ kind: "none" });
  });

  it("does NOT call getMe when there's no cache (no needless network)", async () => {
    const getMe = getMeOk();
    await decideRecovery({ cached: null, offlineMode: false, getMe });
    expect(getMe).not.toHaveBeenCalled();
  });
});

describe("decideRecovery — happy path (constraint [8] validate-before-offer)", () => {
  it("returns { kind: 'show', botInfo } when getMe succeeds", async () => {
    const decision = await decideRecovery({
      cached: CACHED,
      offlineMode: false,
      getMe: getMeOk(),
    });
    expect(decision).toEqual({ kind: "show", cached: CACHED, botInfo: BOT_INFO });
  });

  it("calls getMe exactly once with the cached token", async () => {
    const getMe = getMeOk();
    await decideRecovery({ cached: CACHED, offlineMode: false, getMe });
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(getMe).toHaveBeenCalledWith(CACHED.botToken);
  });
});

describe("decideRecovery — revoked token (constraint [8])", () => {
  it("returns { kind: 'drop', reason: 'revoked' } on 401", async () => {
    const decision = await decideRecovery({
      cached: CACHED,
      offlineMode: false,
      getMe: getMeThrowing(new TelegramApiError("Unauthorized", 401)),
    });
    expect(decision).toEqual({ kind: "drop", reason: "revoked", cached: CACHED });
  });

  it("returns { kind: 'drop', reason: 'revoked' } on 403 (same path as 401)", async () => {
    const decision = await decideRecovery({
      cached: CACHED,
      offlineMode: false,
      getMe: getMeThrowing(new TelegramApiError("Forbidden", 403)),
    });
    expect(decision).toEqual({ kind: "drop", reason: "revoked", cached: CACHED });
  });
});

describe("decideRecovery — transient failure (constraint [8] keep-cache branch)", () => {
  it("returns { kind: 'retry' } on 5xx — Telegram unavailable, not revoked", async () => {
    const decision = await decideRecovery({
      cached: CACHED,
      offlineMode: false,
      getMe: getMeThrowing(new TelegramApiError("Internal Server Error", 500)),
    });
    expect(decision).toEqual({ kind: "retry", cached: CACHED });
  });

  it("returns { kind: 'retry' } on 502/503/504", async () => {
    for (const code of [502, 503, 504]) {
      const decision = await decideRecovery({
        cached: CACHED,
        offlineMode: false,
        getMe: getMeThrowing(new TelegramApiError("Bad Gateway", code)),
      });
      expect(decision.kind).toBe("retry");
    }
  });

  it("returns { kind: 'retry' } on a network error (no code)", async () => {
    const decision = await decideRecovery({
      cached: CACHED,
      offlineMode: false,
      getMe: getMeThrowing(new TypeError("Failed to fetch")),
    });
    expect(decision).toEqual({ kind: "retry", cached: CACHED });
  });

  it("returns { kind: 'retry' } on a timeout (AbortError)", async () => {
    const decision = await decideRecovery({
      cached: CACHED,
      offlineMode: false,
      getMe: getMeThrowing(new DOMException("Timed out", "AbortError")),
    });
    expect(decision).toEqual({ kind: "retry", cached: CACHED });
  });
});

describe("decideRecovery — offline mode (constraint [10])", () => {
  it("returns { kind: 'showOffline' } with cache, no getMe call", async () => {
    const getMe = getMeOk();
    const decision = await decideRecovery({
      cached: CACHED,
      offlineMode: true,
      getMe,
    });
    expect(decision).toEqual({ kind: "showOffline", cached: CACHED });
    // Offline mode means NO outbound — the decision must not probe getMe.
    expect(getMe).not.toHaveBeenCalled();
  });

  it("returns { kind: 'none' } when offline AND no cache (offline doesn't manufacture a prompt)", async () => {
    const decision = await decideRecovery({
      cached: null,
      offlineMode: true,
      getMe: getMeOk(),
    });
    expect(decision).toEqual({ kind: "none" });
  });
});
