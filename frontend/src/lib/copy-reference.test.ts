import { describe, it, expect, vi } from "vitest";
import {
  referenceClipboardText,
  copyObjectReference,
} from "@/lib/copy-reference";

describe("referenceClipboardText", () => {
  it("is the markdown link on line 1 and the bare deep link on line 2", () => {
    expect(referenceClipboardText("sequence", 5, "pUC19")).toBe(
      "[pUC19](/sequences?seq=5)\n/sequences?seq=5",
    );
  });
});

describe("copyObjectReference", () => {
  it("writes the payload and returns the toast naming the object", () => {
    const writer = vi.fn();
    const toast = copyObjectReference(
      { type: "collection", id: 12, name: "Cloning" },
      writer,
    );
    expect(writer).toHaveBeenCalledWith(
      "[Cloning](/sequences?collection=12)\n/sequences?collection=12",
    );
    expect(toast).toBe("Copied a link to Cloning.");
  });
});
