/**
 * THROWAWAY static browser demo. NO server, NO dev server, NO websocket.
 *
 * Two independent CodeMirror 6 editors live on the SAME page, each backed by its
 * OWN LoroDoc, wired to each other through an in-page in-memory relay that is the
 * exact dumb byte-pipe a Cloudflare Durable Object would be (it just forwards doc
 * updates and ephemeral/cursor bytes to the other editor, it never reads them).
 *
 * Type in either editor and the text + the remote caret appear live in the other.
 * This is the same mechanic the Yjs spike showed across two browser tabs, but
 * here it runs entirely in one page so a human can open the built dist/index.html
 * file directly (file:// or any static host) and watch convergence + cursors
 * without running anything.
 *
 * The two-tab-over-a-REAL-relay test is a documented MANUAL step (reuse the
 * spikes/collab-yjs wrangler Durable Object) and is intentionally NOT run here.
 */

import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  LoroExtensions,
  getTextFromDoc,
  type UserState,
} from "loro-codemirror";
import { EphemeralStore, LoroDoc, UndoManager } from "loro-crdt";

// --- In-page relay: forwards bytes between the two editors, understands nothing.
type Sink = (bytes: Uint8Array) => void;
class Relay {
  private docSinks = new Map<string, Sink>();
  private ephSinks = new Map<string, Sink>();
  joinDoc(id: string, sink: Sink) { this.docSinks.set(id, sink); }
  joinEph(id: string, sink: Sink) { this.ephSinks.set(id, sink); }
  sendDoc(from: string, bytes: Uint8Array) {
    for (const [id, sink] of this.docSinks) if (id !== from) sink(bytes);
  }
  sendEph(from: string, bytes: Uint8Array) {
    for (const [id, sink] of this.ephSinks) if (id !== from) sink(bytes);
  }
}

const relay = new Relay();

function makeEditor(opts: {
  id: string;
  peerId: bigint;
  parentSel: string;
  user: UserState;
}): EditorView {
  const doc = new LoroDoc();
  doc.setPeerId(opts.peerId);
  const ephemeral = new EphemeralStore();
  const undoManager = new UndoManager(doc, {});

  // OUT: this editor's local doc/ephemeral changes go onto the relay.
  doc.subscribeLocalUpdates((bytes) => relay.sendDoc(opts.id, bytes));
  ephemeral.subscribeLocalUpdates((bytes) => relay.sendEph(opts.id, bytes));
  // IN: the relay delivers the OTHER editor's bytes to this doc/ephemeral.
  relay.joinDoc(opts.id, (bytes) => doc.import(bytes));
  relay.joinEph(opts.id, (bytes) => ephemeral.apply(bytes));

  return new EditorView({
    state: EditorState.create({
      doc: getTextFromDoc(doc).toString(),
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        LoroExtensions(doc, { ephemeral, user: opts.user }, undoManager),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: "100%", fontSize: "14px" },
          ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, monospace" },
        }),
      ],
    }),
    parent: document.querySelector(opts.parentSel)!,
  });
}

const editorA = makeEditor({
  id: "A",
  peerId: 1n,
  parentSel: "#editorA",
  user: { name: "Editor A", colorClassName: "user-a" },
});
const editorB = makeEditor({
  id: "B",
  peerId: 2n,
  parentSel: "#editorB",
  user: { name: "Editor B", colorClassName: "user-b" },
});

// Seed some lab text in A so the page is not empty on open. It relays to B.
editorA.dispatch({
  changes: { from: 0, insert: "PCR master mix\n  25 uL 2x mix\n  1 uL primer F\n  1 uL primer R\n" },
});

// expose for manual poking in devtools
(window as unknown as { __spike: unknown }).__spike = { editorA, editorB, relay };
