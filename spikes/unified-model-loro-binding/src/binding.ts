/**
 * API-maturity typecheck. This file is NEVER run, it is only fed to `tsc --noEmit`
 * (npm run typecheck) to prove loro-codemirror's published types line up with a
 * real CodeMirror 6 EditorView wiring, the same shape the production editor would
 * use. It mirrors spikes/collab-yjs/src/client.ts (the Yjs equivalent) so the two
 * bindings can be compared side by side.
 *
 * It exercises three integration points:
 *   1. LoroExtensions: the all-in-one (sync + ephemeral cursors + undo) extension.
 *   2. The granular plugins (LoroSyncPlugin / LoroEphemeralPlugin / LoroUndoPlugin)
 *      so we know the building blocks are individually typed and usable.
 *   3. The undo/redo commands and the ephemeral-key helpers, the public surface
 *      a real provider needs to wire a relay.
 */

import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import {
  LoroExtensions,
  LoroSyncPlugin,
  LoroEphemeralPlugin,
  LoroUndoPlugin,
  undo,
  redo,
  getTextFromDoc,
  getCursorEphemeralKey,
  getUserEphemeralKey,
  type UserState,
} from "loro-codemirror";
import { EphemeralStore, LoroDoc, UndoManager } from "loro-crdt";

// --- 1. The all-in-one extension (the README's recommended entry point) -------
export function mountAllInOne(parent: HTMLElement): EditorView {
  const doc = new LoroDoc();
  const ephemeral = new EphemeralStore();
  const undoManager = new UndoManager(doc, {});
  const user: UserState = { name: "tab-A", colorClassName: "user1" };

  return new EditorView({
    state: EditorState.create({
      // The doc seeds from the bound Loro Text, the same as ytext.toString().
      doc: getTextFromDoc(doc).toString(),
      extensions: [
        lineNumbers(),
        keymap.of(defaultKeymap),
        LoroExtensions(doc, { ephemeral, user }, undoManager),
        EditorView.lineWrapping,
      ],
    }),
    parent,
  });
}

// --- 2. The granular plugins, wired by hand (what a custom provider would do) --
export function mountGranular(parent: HTMLElement): EditorView {
  const doc = new LoroDoc();
  const ephemeral = new EphemeralStore();
  const undoManager = new UndoManager(doc, {});
  const user: UserState = { name: "tab-B", colorClassName: "user2" };

  return new EditorView({
    state: EditorState.create({
      doc: getTextFromDoc(doc).toString(),
      extensions: [
        LoroSyncPlugin(doc),
        LoroEphemeralPlugin(doc, ephemeral, user),
        LoroUndoPlugin(doc, undoManager),
        keymap.of([
          { key: "Mod-z", run: undo },
          { key: "Mod-Shift-z", run: redo },
        ]),
      ],
    }),
    parent,
  });
}

// --- 3. The ephemeral-key helpers a relay provider needs ----------------------
export function ephemeralKeys(doc: LoroDoc): { cursor: string; user: string } {
  return {
    cursor: getCursorEphemeralKey(doc),
    user: getUserEphemeralKey(doc),
  };
}
