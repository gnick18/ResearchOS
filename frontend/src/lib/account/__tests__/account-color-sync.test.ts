// Unit tests for syncUserColorToAccount: the SELF avatar-color write into the
// account E2E blob. The account-settings IO is mocked so we assert the merge +
// skip-when-unchanged + flag-guard + never-throw behavior in isolation.

import { afterEach, describe, expect, it, vi } from "vitest";

let flagOn = true;
vi.mock("../account-settings-config", () => ({
  isAccountSettingsEnabled: () => flagOn,
}));

const fetchMock = vi.fn();
const writeMock = vi.fn();
vi.mock("../account-settings", () => ({
  fetchAccountSettings: (...args: unknown[]) => fetchMock(...args),
  writeAccountSettings: (...args: unknown[]) => writeMock(...args),
}));

import { syncUserColorToAccount } from "../account-color-sync";

afterEach(() => {
  vi.clearAllMocks();
  flagOn = true;
});

describe("syncUserColorToAccount", () => {
  it("is a no-op when account settings are off (no fetch, no write)", async () => {
    flagOn = false;
    await syncUserColorToAccount("#ffffff", null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("writes the new color into the existing blob, preserving other fields", async () => {
    fetchMock.mockResolvedValue({
      displayName: "Jane",
      color: "#111111",
      colorSecondary: null,
    });
    writeMock.mockResolvedValue(true);
    await syncUserColorToAccount("#3b82f6", "#10b981");
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith({
      displayName: "Jane",
      color: "#3b82f6",
      colorSecondary: "#10b981",
    });
  });

  it("skips the write when both color and secondary are unchanged", async () => {
    fetchMock.mockResolvedValue({ color: "#3b82f6", colorSecondary: "#10b981" });
    await syncUserColorToAccount("#3b82f6", "#10b981");
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("seeds the color onto an empty (null) blob", async () => {
    fetchMock.mockResolvedValue(null);
    writeMock.mockResolvedValue(true);
    await syncUserColorToAccount("#3b82f6", null);
    expect(writeMock).toHaveBeenCalledWith({ color: "#3b82f6", colorSecondary: null });
  });

  it("treats undefined inputs as null", async () => {
    fetchMock.mockResolvedValue({ color: "#3b82f6", colorSecondary: "#10b981" });
    writeMock.mockResolvedValue(true);
    await syncUserColorToAccount(undefined, undefined);
    expect(writeMock).toHaveBeenCalledWith({ color: null, colorSecondary: null });
  });

  it("never throws when the account layer fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(syncUserColorToAccount("#ffffff", null)).resolves.toBeUndefined();
    expect(writeMock).not.toHaveBeenCalled();
  });
});
