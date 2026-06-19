// Unit tests for the BeakerBot inline-settings tools (inline-settings bot,
// 2026-06-19). These pin the safety contract that matters most: the write-list
// is enforced by code, not prompt text. read_setting reports value + tier and
// marks a sensitive key; update_setting WRITES a safe boolean and a safe enum,
// REFUSES every sensitive key (account / membership / money) with a handoff and
// NO patch call, refuses internal keys, refuses an unknown off-schema key, and
// rejects a wrong-typed value.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  readSettingTool,
  updateSettingTool,
  settingsToolsDeps,
  settingTier,
  isWritableSettingKey,
} from "../settings-tools";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/settings/user-settings";

// A spyable patch the tool calls on a successful write. Reset before each test so
// the "NO patch call" assertions are honest.
let patchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  patchSpy = vi.fn(async (_username: string, patch: Partial<UserSettings>) => {
    return { ...DEFAULT_SETTINGS, ...patch } as UserSettings;
  });
  settingsToolsDeps.getCurrentUser = vi.fn(async () => "tester");
  settingsToolsDeps.readUserSettings = vi.fn(
    async (): Promise<UserSettings> => ({
      ...DEFAULT_SETTINGS,
      dateFormat: "MDY",
      sidebarShowTasks: true,
      account_type: "member",
    }),
  );
  settingsToolsDeps.patchUserSettings = patchSpy as unknown as (
    username: string,
    patch: Partial<UserSettings>,
  ) => Promise<UserSettings>;
});

describe("settingTier classifier", () => {
  it("classifies safe, caution, sensitive, and internal keys", () => {
    expect(settingTier("sidebarShowTasks")).toBe("safe");
    expect(settingTier("dateFormat")).toBe("safe");
    expect(settingTier("confirmDestructiveActions")).toBe("caution");
    expect(settingTier("account_type")).toBe("sensitive");
    expect(settingTier("purchaseRouting")).toBe("sensitive");
    expect(settingTier("schemaVersion")).toBe("internal");
    expect(settingTier("lab_envelope_cache")).toBe("internal");
    // An off-schema key (not a UserSettings field) defaults to sensitive (handoff).
    expect(settingTier("twoFactor")).toBe("sensitive");
  });

  it("only allows writing safe and caution keys", () => {
    expect(isWritableSettingKey("sidebarShowTasks")).toBe(true);
    expect(isWritableSettingKey("confirmDestructiveActions")).toBe(true);
    expect(isWritableSettingKey("account_type")).toBe(false);
    expect(isWritableSettingKey("schemaVersion")).toBe(false);
    expect(isWritableSettingKey("twoFactor")).toBe(false);
  });
});

describe("read_setting", () => {
  it("returns value + tier for a safe key", async () => {
    const res = (await readSettingTool.execute({ key: "dateFormat" })) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(true);
    expect(res.key).toBe("dateFormat");
    expect(res.value).toBe("MDY");
    expect(res.tier).toBe("safe");
    // A safe key carries a setting embed so the chat can render the live control.
    expect(typeof res.embed).toBe("string");
    expect(res.embed).toContain("ros-setting:dateFormat");
  });

  it("marks a sensitive key with a handoff, no value control", async () => {
    const res = (await readSettingTool.execute({ key: "account_type" })) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(true);
    expect(res.tier).toBe("sensitive");
    expect(res.handoff).toBe(true);
    expect(typeof res.settingsHref).toBe("string");
    expect(res.embed).toBeUndefined();
  });

  it("refuses an internal key as not a user setting", async () => {
    const res = (await readSettingTool.execute({ key: "schemaVersion" })) as Record<
      string,
      unknown
    >;
    expect(res.tier).toBe("internal");
    expect(typeof res.note).toBe("string");
    expect(res.value).toBeUndefined();
  });
});

describe("update_setting write-list enforcement", () => {
  it("writes a safe boolean via patchUserSettings", async () => {
    const res = (await updateSettingTool.execute({
      key: "sidebarShowTasks",
      value: false,
    })) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledWith("tester", { sidebarShowTasks: false });
    expect(res.embed).toContain("ros-setting:sidebarShowTasks");
  });

  it("writes a safe enum via patchUserSettings", async () => {
    const res = (await updateSettingTool.execute({
      key: "dateFormat",
      value: "YMD",
    })) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledWith("tester", { dateFormat: "YMD" });
  });

  it("writes the caution key but carries its consequence", async () => {
    const res = (await updateSettingTool.execute({
      key: "confirmDestructiveActions",
      value: false,
    })) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(patchSpy).toHaveBeenCalledWith("tester", {
      confirmDestructiveActions: false,
    });
    expect(typeof res.caution).toBe("string");
  });

  const sensitiveKeys = [
    "account_type",
    "purchaseRouting",
    "lab_id",
    "dept_admin_of",
    "institution_admin_of",
    "labMembershipAgreement",
  ];

  for (const key of sensitiveKeys) {
    it(`refuses sensitive key ${key} with a handoff and NO patch call`, async () => {
      const res = (await updateSettingTool.execute({
        key,
        value: "anything",
      })) as Record<string, unknown>;
      expect(res.ok).toBe(false);
      expect(res.handoff).toBe(true);
      expect(typeof res.settingsHref).toBe("string");
      expect(typeof res.reason).toBe("string");
      expect(patchSpy).not.toHaveBeenCalled();
    });
  }

  it("refuses an internal key with no patch call", async () => {
    const res = (await updateSettingTool.execute({
      key: "schemaVersion",
      value: 2,
    })) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("refuses an unknown off-schema key with a handoff and no patch call", async () => {
    const res = (await updateSettingTool.execute({
      key: "twoFactor",
      value: true,
    })) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(res.handoff).toBe(true);
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("rejects a wrong-typed value for a boolean key with no patch call", async () => {
    const res = (await updateSettingTool.execute({
      key: "sidebarShowTasks",
      value: "yes",
    })) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe("string");
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range enum value with no patch call", async () => {
    const res = (await updateSettingTool.execute({
      key: "dateFormat",
      value: "ISO8601",
    })) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(patchSpy).not.toHaveBeenCalled();
  });
});
