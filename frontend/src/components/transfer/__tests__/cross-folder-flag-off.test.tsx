// Flag-off guarantee for the cross-folder entry points.
//
// NEXT_PUBLIC_CROSS_FOLDER is unset in the test env (the feature is off by
// default), so CROSS_FOLDER_ENABLED is false. Every cross-folder entry point
// MUST render nothing in that state, so the surface is byte-identical to a build
// without the feature. We render each component to static markup and assert it
// produces empty output (the `if (!CROSS_FOLDER_ENABLED) return null` guard runs
// synchronously, before any effect-driven state, so a server render is enough).

import { describe, expect, it, beforeAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { CROSS_FOLDER_ENABLED } from "@/lib/file-system/cross-folder-config";
import {
  CopyMoveToFolderButton,
  BulkTransferDialog,
} from "@/components/transfer/FolderDestinationPicker";
import CopyNoteToFolderButton from "@/components/transfer/FolderDestinationPicker";
import type { TransferTarget } from "@/lib/transfer/local-folder-transfer";
import type { Note } from "@/lib/types";

const NOTE = {
  id: 1,
  title: "n",
  description: "",
  is_running_log: false,
  is_shared: false,
  entries: [],
  comments: [],
  created_at: "",
  updated_at: "",
  username: "alice",
} as Note;

const NOTE_TARGET: TransferTarget = {
  kind: "note",
  note: NOTE,
  sourceUsername: "alice",
};

describe("cross-folder entry points, flag OFF", () => {
  beforeAll(() => {
    // Guard the premise: this whole suite is meaningful only when the flag is
    // off (the default). If someone runs with the flag on, fail loudly rather
    // than silently passing a vacuous assertion.
    expect(CROSS_FOLDER_ENABLED).toBe(false);
  });

  it("CopyMoveToFolderButton renders nothing", () => {
    const html = renderToStaticMarkup(
      createElement(CopyMoveToFolderButton, { target: NOTE_TARGET }),
    );
    expect(html).toBe("");
  });

  it("BulkTransferDialog renders nothing", () => {
    const html = renderToStaticMarkup(
      createElement(BulkTransferDialog, {
        items: [NOTE_TARGET],
        onClose: () => {},
      }),
    );
    expect(html).toBe("");
  });

  it("CopyNoteToFolderButton (Stage 1) renders nothing", () => {
    const html = renderToStaticMarkup(
      createElement(CopyNoteToFolderButton, {
        note: NOTE,
        sourceUsername: "alice",
      }),
    );
    expect(html).toBe("");
  });
});
