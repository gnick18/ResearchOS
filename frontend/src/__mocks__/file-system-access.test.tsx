// Sample jsdom-env test that exercises the FSA mock. Lives next to the mock
// for discoverability; covers seeding, reading, writing, removing, and the
// not-found code path. Component-level RTL tests can follow this pattern.

import { describe, expect, it } from "vitest";
import {
  getMockRootDirectoryHandle,
  installShowDirectoryPickerMock,
  resetVirtualFileSystem,
  seedVirtualFileSystem,
} from "./file-system-access";

describe("file-system-access mock", () => {
  it("seeds nested files via slash-delimited paths", async () => {
    resetVirtualFileSystem();
    seedVirtualFileSystem({
      "users/GrantNickles/_onboarding.json": '{"mode":"suggestions"}',
      "users/GrantNickles/tasks/1.json": '{"id":1,"name":"Test task"}',
    });

    const root = getMockRootDirectoryHandle();
    const users = await root.getDirectoryHandle("users");
    const grant = await users.getDirectoryHandle("GrantNickles");
    const onboardingHandle = await grant.getFileHandle("_onboarding.json");
    const onboardingFile = await onboardingHandle.getFile();
    expect(await onboardingFile.text()).toBe('{"mode":"suggestions"}');

    const tasksDir = await grant.getDirectoryHandle("tasks");
    const taskHandle = await tasksDir.getFileHandle("1.json");
    expect(await (await taskHandle.getFile()).text()).toContain('"Test task"');
  });

  it("returns NotFoundError for missing entries (no opts.create)", async () => {
    resetVirtualFileSystem();
    seedVirtualFileSystem({ "users/GrantNickles/_onboarding.json": "{}" });

    const root = getMockRootDirectoryHandle();
    const users = await root.getDirectoryHandle("users");
    const grant = await users.getDirectoryHandle("GrantNickles");

    await expect(grant.getFileHandle("does-not-exist.json")).rejects.toMatchObject({
      name: "NotFoundError",
    });
    await expect(grant.getDirectoryHandle("missing-dir")).rejects.toMatchObject({
      name: "NotFoundError",
    });
  });

  it("creates new files when opts.create is true and write/read roundtrips", async () => {
    resetVirtualFileSystem();
    const root = getMockRootDirectoryHandle();
    const dir = await root.getDirectoryHandle("scratch", { create: true });
    const file = await dir.getFileHandle("note.txt", { create: true });

    const writable = await file.createWritable();
    await writable.write("hello world");
    await writable.close();

    const blob = await file.getFile();
    expect(await blob.text()).toBe("hello world");
  });

  it("removes entries and reports removal", async () => {
    resetVirtualFileSystem();
    seedVirtualFileSystem({ "scratch/x.txt": "hi" });
    const root = getMockRootDirectoryHandle();
    const dir = await root.getDirectoryHandle("scratch");

    await dir.removeEntry("x.txt");
    await expect(dir.getFileHandle("x.txt")).rejects.toMatchObject({
      name: "NotFoundError",
    });
  });

  it("permission queries always return granted", async () => {
    resetVirtualFileSystem();
    const root = getMockRootDirectoryHandle();
    expect(await root.queryPermission()).toBe("granted");
    expect(await root.requestPermission()).toBe("granted");
  });

  it("installShowDirectoryPickerMock wires window.showDirectoryPicker", async () => {
    resetVirtualFileSystem();
    seedVirtualFileSystem({ "marker.txt": "ok" });
    installShowDirectoryPickerMock();

    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<unknown> })
      .showDirectoryPicker;
    expect(typeof picker).toBe("function");

    const handle = (await picker!()) as Awaited<ReturnType<typeof getMockRootDirectoryHandle>>;
    const marker = await handle.getFileHandle("marker.txt");
    expect(await (await marker.getFile()).text()).toBe("ok");
  });
});
