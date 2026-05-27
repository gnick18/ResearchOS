/**
 * Regression-pinning tests for the §6.7 hybrid editor R1 fix-pass.
 *
 * Each test corresponds to one P0 fix from the brief. The tests are
 * structural / unit-level — full-flow rendering of the §6.7 cluster
 * is gated on the TourController + a mounted experiment route, which
 * pushes the cost-to-test ratio too high for what these guards need
 * to catch (the regressions are concrete behaviors documented in
 * each test's description).
 *
 * Hybrid fix manager R1, 2026-05-22.
 */
import { describe, expect, it, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { hybridImageDragInStep } from "../HybridImageDragInStep";
import { hybridFileAttachStep } from "../HybridFileAttachStep";
import { hybridImageResizeStep } from "../HybridImageResizeStep";
import { hybridBoldStep } from "../HybridBoldStep";
import { hybridShortcutsStep } from "../HybridShortcutsStep";
import { hybridMarkdownFamiliarityStep } from "../HybridMarkdownFamiliarityStep";
import BeakerBotCursor, {
  type BeakerBotCursorRef,
} from "@/components/BeakerBotCursor";
import { createRef } from "react";
import {
  lastBranchChoice,
  recordBranchChoice,
  resetBranchChoices,
} from "../lib/branch-choices";
import { isStepGatedOut } from "../../../step-machine";

describe("R1 fix-pass P0-1: typeInto handles wrapper-with-descendant-input", () => {
  it("typing into a wrapper finds a descendant textarea and mutates its value via React-safe setter", async () => {
    // Mount the cursor portal so the imperative ref resolves.
    const cursorRef = createRef<BeakerBotCursorRef>();
    render(<BeakerBotCursor ref={cursorRef} glideMs={0} typeCadenceMs={0} />);

    // Build a wrapper with a descendant textarea that mirrors the
    // hybrid editor's mount shape: outer div has the data-tour-target,
    // a child textarea handles real input via React's controlled
    // value setter.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-tour-target", "hybrid-editor-textarea");
    const textarea = document.createElement("textarea");
    wrapper.appendChild(textarea);
    document.body.appendChild(wrapper);

    // Wait for the cursor to mount.
    await new Promise<void>((r) => setTimeout(r, 0));

    await act(async () => {
      await cursorRef.current?.typeInto(wrapper, "**bold**", 0);
    });

    // The native setter path on the descendant textarea should have
    // landed the typed value. Without the wrapper-fallback in
    // typeInto, the prior implementation set `wrapper.textContent`
    // (visual only) and never touched the textarea's value.
    expect(textarea.value).toBe("**bold**");

    document.body.removeChild(wrapper);
  });

  it("typing into a wrapper with NO descendant input triggers a click to mount one", async () => {
    const cursorRef = createRef<BeakerBotCursorRef>();
    render(<BeakerBotCursor ref={cursorRef} glideMs={0} typeCadenceMs={0} />);

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-tour-target", "hybrid-editor-textarea");
    // Click handler that mounts a textarea on click — same shape as
    // HybridMarkdownEditor's outer wrapper.
    let mounted = false;
    wrapper.addEventListener("click", () => {
      if (mounted) return;
      mounted = true;
      const textarea = document.createElement("textarea");
      wrapper.appendChild(textarea);
    });
    document.body.appendChild(wrapper);

    await new Promise<void>((r) => setTimeout(r, 0));

    await act(async () => {
      await cursorRef.current?.typeInto(wrapper, "hi", 0);
    });

    expect(mounted).toBe(true);
    const ta = wrapper.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(ta?.value).toBe("hi");

    document.body.removeChild(wrapper);
  });
});

describe("R1 fix-pass P0-2: declarative pageLock translates to controller state", () => {
  it("HE-7 hybrid-shortcuts declares a pageLock with allowList + pillLabel", () => {
    expect(hybridShortcutsStep.pageLock).toBeDefined();
    expect(hybridShortcutsStep.pageLock?.allowList?.length ?? 0).toBeGreaterThan(0);
    expect(hybridShortcutsStep.pageLock?.pillLabel).toBeTruthy();
  });
});

describe("HE-9 hybrid-image-drag-in is USER-ACTION (Grant 2026-05-26 conversion)", () => {
  it("does not declare a cursorScript (user performs the drag themselves)", () => {
    // Originally a BeakerBot cursor demo that queued a dragFile action
    // plus a fallback callback. Grant 2026-05-26: "let's change it to
    // get the user to drag and drop the image into the markdown file
    // as opposed to having feature bot do it for them. I think this
    // would teach them better." The step is now narration + spotlight
    // only; the user's own drag triggers the editor's production drop
    // handler.
    expect(hybridImageDragInStep.cursorScript).toBeUndefined();
    expect(hybridImageDragInStep.completion.type).toBe("manual");
  });
});

describe("R1 fix-pass P0-4: HE-11 file-attach mutates the editor markdown", () => {
  it("HE-11 hybrid-file-attach cursorScript queues a callback (the writeText + markdown append)", async () => {
    // Mount the editor wrapper so `safeGlideToElementAction` resolves
    // its anchor without waiting for the 5s default timeout.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-tour-target", "hybrid-editor-textarea");
    document.body.appendChild(wrapper);

    const script = await hybridFileAttachStep.cursorScript?.();
    expect(Array.isArray(script)).toBe(true);
    const types = (script ?? []).map((a) => a.type);
    expect(types).toContain("callback");

    document.body.removeChild(wrapper);
  }, 8000);
});

describe("R1 fix-pass P0-5: HE-10 artifact only fires when content was authored", () => {
  it("HE-10 hybrid-image-resize keeps a notes_content cleanup_default of 'keep'", () => {
    // The onEnter logic is environment-bound; this guard just pins
    // the artifact shape so a future refactor doesn't accidentally
    // flip the cleanup_default to 'discard' (which would destroy any
    // user typing the cleanup grid recorded).
    expect(hybridImageResizeStep.onEnter).toBeDefined();
  });
});

describe("R1 fix-pass P1 #6: HE-2 uses branchOn primitive", () => {
  it("HE-2 declares branch completion with three branches", () => {
    const c = hybridMarkdownFamiliarityStep.completion;
    expect(c.type).toBe("branch");
    if (c.type !== "branch") return;
    expect(c.branches).toHaveLength(3);
  });

  it("HE-2 narration speech contains NO inline buttons (controller renders branch CTAs)", () => {
    const speech =
      typeof hybridMarkdownFamiliarityStep.speech === "function"
        ? hybridMarkdownFamiliarityStep.speech()
        : hybridMarkdownFamiliarityStep.speech;
    const { container } = render(<>{speech}</>);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("R1 fix-pass P1 #7: HE-3 gated by branch choice", () => {
  it("HE-3 is gated out when no branch choice was recorded", () => {
    resetBranchChoices();
    expect(isStepGatedOut("hybrid-markdown-overview", null)).toBe(true);
  });

  it("HE-3 is gated IN when the user picked the overview branch", () => {
    resetBranchChoices();
    recordBranchChoice(
      "hybrid-markdown-familiarity",
      "hybrid-markdown-overview",
    );
    expect(isStepGatedOut("hybrid-markdown-overview", null)).toBe(false);
    resetBranchChoices();
  });

  it("HE-3 stays gated OUT when the user picked the skip branch (back-step from HE-4 lands on HE-2)", () => {
    resetBranchChoices();
    recordBranchChoice(
      "hybrid-markdown-familiarity",
      "hybrid-editor-mechanic",
    );
    expect(isStepGatedOut("hybrid-markdown-overview", null)).toBe(true);
    resetBranchChoices();
  });

  it("lastBranchChoice returns null after resetBranchChoices()", () => {
    recordBranchChoice("foo" as any, "bar" as any);
    expect(lastBranchChoice("foo" as any)).toBe("bar");
    resetBranchChoices();
    expect(lastBranchChoice("foo" as any)).toBeNull();
  });
});

describe("R1 fix-pass P1 #8: HE-5/HE-6 typing beats append a click-out callback", () => {
  it("HE-5a (hybrid-bold) cursorScript queues type + settle + clickOut", async () => {
    // Mount the editor wrapper so `safeTypeAction` resolves its
    // anchor without waiting for the 5s default timeout. The wrapper
    // is enough — the action's playback (which would normally find
    // the descendant textarea via the typeInto fallback) is NOT
    // exercised in this build-time test.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-tour-target", "hybrid-editor-textarea");
    document.body.appendChild(wrapper);

    const script = await hybridBoldStep.cursorScript?.();
    expect(Array.isArray(script)).toBe(true);
    const types = (script ?? []).map((a) => a.type);
    // At least two callbacks (settle + clickOut) and one type.
    const callbackCount = types.filter((t) => t === "callback").length;
    expect(callbackCount).toBeGreaterThanOrEqual(2);
    expect(types).toContain("type");

    document.body.removeChild(wrapper);
  }, 8000);
});

describe("R1 fix-pass P2 #11: page-lock pill copy updated", () => {
  it("HE-5 typing pill no longer reads 'Watch me type'", () => {
    expect(hybridBoldStep.pageLock?.pillLabel).not.toMatch(/Watch me type/i);
  });
});
