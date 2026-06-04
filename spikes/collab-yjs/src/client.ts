/**
 * THROWAWAY spike browser client. Mounts a CodeMirror 6 editor whose document
 * is a single Y.Text, bound via y-codemirror.next's yCollab extension, and
 * connects to the local Durable Object relay through RelayProvider.
 *
 * Open this page in two browser tabs: type in one and it appears in the other
 * in real time, with a live remote cursor + selection (yCollab renders remote
 * carets from the awareness protocol). This is the MVP mechanic from section
 * 11 of CROSS_BOUNDARY_SHARING_COLLABORATE.md.
 */

import * as Y from "yjs";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { yCollab } from "y-codemirror.next";
import { RelayProvider } from "./relay-provider";

const COLORS = [
  { color: "#1e90ff", light: "#1e90ff33" },
  { color: "#e6446e", light: "#e6446e33" },
  { color: "#30a46c", light: "#30a46c33" },
  { color: "#f5a524", light: "#f5a52433" },
];
const me = COLORS[Math.floor(Math.random() * COLORS.length)];
const name = "tab-" + Math.floor(Math.random() * 1000);

const doc = new Y.Doc();
const ytext = doc.getText("note");

const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") +
  location.host + "/ws";
const provider = new RelayProvider(wsUrl, doc);

// Identify this client for remote-cursor rendering.
provider.awareness.setLocalStateField("user", {
  name,
  color: me.color,
  colorLight: me.light,
});

const statusEl = document.getElementById("status")!;
provider.onSynced(() => {
  statusEl.textContent = "connected + synced as " + name;
});
statusEl.textContent = "connecting as " + name + "...";

const view = new EditorView({
  state: EditorState.create({
    doc: ytext.toString(),
    extensions: [
      lineNumbers(),
      keymap.of(defaultKeymap),
      yCollab(ytext, provider.awareness),
      EditorView.lineWrapping,
    ],
  }),
  parent: document.getElementById("editor")!,
});

// expose for manual poking in devtools
(window as any).__spike = { doc, ytext, provider, view };
