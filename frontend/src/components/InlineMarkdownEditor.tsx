"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorState as EditorStateType } from "@codemirror/state";
import type { EditorLoroHandle } from "@/lib/loro/editor-handle";
import type { Note } from "@/lib/types";
import type { EphemeralStore } from "loro-crdt";
import type { UserState, EphemeralState } from "loro-codemirror";
import { getEntryContentText } from "@/lib/loro/note-doc";
import CodeLanguagePicker from "./CodeLanguagePicker";
import {
  buildFencedCodeInsertion,
  isCodeBlockInsertSyntax,
} from "@/lib/markdown/cm-inline-reveal/code-languages";
import { detectUnfence } from "@/lib/markdown/cm-inline-reveal/markdown-keymap";
import { isBlockEmbedMarkdown } from "@/lib/references";
// P7-2 transclusion normalize (normalizeRef wiring).
import { normalizeTransclusions } from "@/lib/embeds/normalize-transclusions";
import { notesApi } from "@/lib/local-api";

/**
 * Read the seed markdown for a Loro-bound surface. A task surface exposes its
 * own editorSeedText (the single "content" text); a note has none, so we fall
 * back to the active entry's content text. Keeps the editor model-agnostic.
 */
function seedTextForHandle(handle: EditorLoroHandle, activeIndex: number): string {
  if (handle.editorSeedText) return handle.editorSeedText(activeIndex);
  return getEntryContentText(handle.doc, activeIndex)?.toString() ?? "";
}

/**
 * Inline ("Typora-style") Markdown editor — Typora editor chip 1 (T1 + T2).
 *
 * This is the sole editing surface (EditorMode "inline"): it mounts a
 * CodeMirror 6 EditorView whose DOCUMENT IS THE MARKDOWN TEXT. CM6 never
 * re-serializes the source: every "render" is a view-only decoration, so the
 * local-first round-trip contract is structurally guaranteed (proven by
 * InlineMarkdownEditor.roundtrip.test.tsx — the go/no-go gate). Our markdown
 * dialect (single-underscore underline, literal <u>, <!-- stamp --> comments,
 * raw <img>, GFM) survives byte-for-byte because the editor stores those bytes
 * and only highlights them.
 *
 * This editor owns its OWN CM6 history() undo stack and never autosaves to
 * the parent. The manual-save contract is saveRef / onExplicitSave /
 * onDirtyChange / value-in-onChange-out. Caret-aware marker hiding / inline
 * reveal is chip 2 (MARKDOWN_EDITOR_TYPORA_INLINE_REVEAL_DESIGN.md).
 *
 * The CM6 packages are loaded via a DYNAMIC import() so non-Notes surfaces
 * (and the initial app bundle) never pull the editor code. While the chunk
 * loads we render a lightweight "Loading editor..." placeholder.
 */

// The CM6 module surface we lazily import. Typed loosely (the dynamic import
// returns `any`-ish module objects); we narrow what we actually use.
type CMModules = {
  EditorState: typeof import("@codemirror/state").EditorState;
  EditorView: typeof import("@codemirror/view").EditorView;
  // Prec.highest is used to register the code-block override keymap ABOVE the
  // inline-reveal markdown keymap (Prec.high), so Mod-Shift-c opens the language
  // picker instead of inserting a bare fence.
  Prec: typeof import("@codemirror/state").Prec;
  keymap: typeof import("@codemirror/view").keymap;
  drawSelection: typeof import("@codemirror/view").drawSelection;
  highlightActiveLine: typeof import("@codemirror/view").highlightActiveLine;
  history: typeof import("@codemirror/commands").history;
  historyKeymap: typeof import("@codemirror/commands").historyKeymap;
  defaultKeymap: typeof import("@codemirror/commands").defaultKeymap;
  indentWithTab: typeof import("@codemirror/commands").indentWithTab;
  markdown: typeof import("@codemirror/lang-markdown").markdown;
  // GFM-enabled base parser so Strikethrough / Table nodes exist for the
  // inline-reveal walk. Bare markdown() is commonmark-only.
  markdownLanguage: typeof import("@codemirror/lang-markdown").markdownLanguage;
  syntaxHighlighting: typeof import("@codemirror/language").syntaxHighlighting;
  HighlightStyle: typeof import("@codemirror/language").HighlightStyle;
  tags: typeof import("@lezer/highlight").tags;
  // Chip 2a: the caret-aware inline-reveal layer (plugin + theme). Chip 2b
  // extends the same extension with the block + image widgets and the markdown
  // keymap; the plugin stays view-only (the keymap is the only doc-dispatching
  // member, on a user keypress), so the round-trip + save contract are untouched.
  inlineRevealExtension: typeof import("@/lib/markdown/cm-inline-reveal/inline-reveal").inlineRevealExtension;
  // Chip 2b: configures the image widget's relative-src -> blob-URL resolution
  // with the editor base path, matching the LiveMarkdownEditor preview.
  imageBasePathExt: typeof import("@/lib/markdown/cm-inline-reveal/inline-reveal").imageBasePathExt;
  // Markdown embed hybrid P7-1a: configures the embed block widget's pin context
  // (sidecar path + bake deps) so a pinned embed renders its frozen snapshot and
  // offers a Pin / Unpin control. Undefined leaves embeds live (no pin control).
  embedPinContextExt: typeof import("@/lib/markdown/cm-inline-reveal/inline-reveal").embedPinContextExt;
  // Spell-check: an optional @codemirror/lint linter that underlines misspelled
  // words with click-to-fix suggestions. Loaded with the editor chunk and only
  // spread into the extension set when the user's pref is on (gate read below).
  spellcheckExtension: typeof import("@/lib/markdown/cm-spellcheck/spellcheck").spellcheckExtension;
};

/**
 * Read the spell-check pref synchronously from localStorage (mirrored from
 * settings.json by the Settings UI, same first-paint pattern as the editor
 * width preset). Kept inline so the editor module never statically pulls the
 * spellcheck code; the linter itself rides the dynamic CM import below.
 */
function spellcheckEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("ros.spellcheck.enabled") === "1";
  } catch {
    return false;
  }
}

interface InlineMarkdownEditorProps {
  /** The markdown source. The CM6 document is seeded from this and reconciled
   *  when an EXTERNAL swap arrives (a value that differs from what the editor
   *  itself last emitted). */
  value: string;
  /** Fired when the document changes. Driven from a CM6 updateListener so an
   *  external `value` swap can reconcile (we echo-guard so our own dispatch
   *  does not loop back through here). */
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Manual-save contract. saveRef.current returns the latest doc string
   *  synchronously so a parent Save button can flush + persist. */
  saveRef?: React.MutableRefObject<(() => string) | null>;
  /** Imperative insert API (mirrors saveRef). When set we point it at a
   *  function that splices the given markdown syntax in at the current CM6
   *  selection (replacing any selected text), then refocuses the editor. The
   *  Style Guide rail in MarkdownShortcutsSidebar calls this to make its
   *  click-to-insert entries land in the inline editor. Cleared on unmount. */
  insertRef?: React.MutableRefObject<((syntax: string) => void) | null>;
  /** P7-2 transclusion normalize. When set, we point it at an async function
   *  that reads the current CM6 doc text, resolves note titles to ids from the
   *  notes list, runs normalizeTransclusions, and if the content changed
   *  dispatches a single CM6 replace so the normalized links flow through the
   *  LoroSyncPlugin / onChange into storage. Callers await this BEFORE calling
   *  persistEntryContent so the persisted bytes carry the portable links in
   *  BOTH Loro and legacy modes. Unresolved ![[]] are left raw; a list-fetch
   *  failure is swallowed and the content is left untouched. Cleared on unmount.
   *
   *  Works in both Loro and non-Loro modes: the dispatch goes through the CM6
   *  updateListener so LoroSyncPlugin sees it (Loro mode) or onChange fires
   *  normally (legacy mode). The double-normalize with the legacy
   *  normalizeEntryContent in notesApi.updateEntry is idempotent and safe. */
  normalizeRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  /** Fired on an explicit save (Cmd/Ctrl+S) with the committed document so the
   *  parent can persist it to disk. NO autosave: this is the only push. */
  onExplicitSave?: (value: string) => void;
  /** Fired when the editor's dirty flag flips (first edit since the last
   *  external value / save). Lets a parent that owns its own Save button light
   *  it the moment the user types. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Fluid ch-based measure class (Narrow / Comfortable / Wide / Full-bleed),
   *  mirroring how LiveMarkdownEditor centers the preview + focus surfaces. */
  measureClass?: string;
  /** Chip 2b: the directory a relative image src (Images/...) resolves against,
   *  so the inline image widget mints the same blob URL the preview does. When
   *  unset the blobUrlResolver falls back to the data root (wrapper parity). */
  imageBasePath?: string;
  /** Markdown embed hybrid P7-1a: the doc-level pin context (sidecar path + bake
   *  deps). When set, a pinned embed renders its frozen snapshot and offers a
   *  Pin / Unpin control. Absent on every read-only / non-pin surface, then embeds
   *  render live with no pin control (byte-for-byte unchanged). */
  embedPinContext?: import("@/components/embeds/ObjectEmbed").EmbedPinContext;

  // ---------------------------------------------------------------------------
  // Reference picker hook (Chemistry Phase 3). Additive and OFF by default.
  // ---------------------------------------------------------------------------
  /** When set, called when the user types "/" at a word boundary (start of a
   *  token, possibly after whitespace). The host opens its ReferencePicker and
   *  when the user picks an item inserts the markdown via insertRef. The "/"
   *  that triggered this is removed from the document before the callback fires
   *  so a picked reference replaces the slash cleanly. When absent the slash
   *  behaves exactly as normal text insertion (zero change to existing sites). */
  onRequestReference?: () => void;

  // ---------------------------------------------------------------------------
  // Loro CRDT pilot (additive; when absent the editor behaves exactly as today)
  // ---------------------------------------------------------------------------
  /** When set, the editor runs in Loro mode: seeds from the Loro text, binds
   *  LoroExtensions (sync + ephemeral + undo), drops CM6 history(), and commits
   *  through the handle on every change. When absent, no behaviour changes.
   *  Accepts either a note handle or a task surface handle (experiment collab)
   *  via the shared EditorLoroHandle shape. The task handle seeds from the doc's
   *  single "content" text, commits with no base argument, and has no entry set
   *  to reconcile, so the note-specific ensureEntries / entry-index paths are
   *  skipped (they are optional members on the interface). */
  loroHandle?: EditorLoroHandle;
  /** Which entry inside the note doc to bind. Defaults to 0. A single-text task
   *  surface ignores the index (the popup passes 0). */
  loroEntryIndex?: number;
  /** The live Note object (note path only). The commit() call reads it from a
   *  ref so a per-render-new identity never destabilises the updateListener.
   *  Undefined on the task path; the task handle ignores the commit argument. */
  loroBaseNote?: Note;

  // ---------------------------------------------------------------------------
  // Live collab cursors (Phase 3 chunk 5a; additive; absent = sync-only mode)
  // ---------------------------------------------------------------------------
  /**
   * The shared EphemeralStore for the live collab session.
   *
   * When provided alongside `collabUser`, LoroEphemeralPlugin is installed
   * next to LoroSyncPlugin so local cursor movements are relayed to remote
   * peers and remote cursors are rendered in the editor. When absent (no live
   * session, or flag off) the editor is sync-only with zero change to behavior.
   *
   * Must be the SAME instance exposed by useCollabSession, so the relay
   * provider and the editor plugin share one store.
   */
  collabEphemeral?: EphemeralStore<EphemeralState>;
  /**
   * User info for this peer's cursor label and color.
   *
   * Must be provided together with collabEphemeral. Shape matches UserState
   * from loro-codemirror: { name: string; colorClassName: string }.
   */
  collabUser?: UserState;
}

/**
 * Build the markdown highlight style. Static colors (no theme dependency) so
 * the editor reads as basic-but-clear markdown source. Chip 2a layers the
 * caret-aware reveal (inlineRevealExtension) on top of this; the underlying
 * syntax highlight remains as the source-mode color for revealed tokens.
 */
function buildExtensions(
  mods: CMModules,
  editable: boolean,
  imageBasePath: string | undefined,
  // Called when the user triggers "insert code block" (Mod-Shift-c) on a range
  // that is NOT already inside a fence. The editor opens the language picker
  // instead of inserting a bare fence. Read from a ref so the once-built keymap
  // always sees the live handler. When omitted (preview / no-React host) the
  // override is not installed and the base keymap inserts a bare fence.
  onRequestCodeBlock?: (view: import("@codemirror/view").EditorView) => boolean,
  // When true, omit history() + historyKeymap because LoroUndoPlugin (bundled
  // inside bindEditorExtension) owns undo. Running both double-applies undo.
  omitHistory = false,
  // Markdown embed hybrid P7-1a: the doc-level pin context (sidecar path + bake
  // deps). Spread as the embedPinContext facet so the embed block widget can
  // resolve a frozen snapshot and offer Pin / Unpin. Undefined leaves embeds live.
  embedPinContext?: import("@/components/embeds/ObjectEmbed").EmbedPinContext,
) {
  const {
    EditorState,
    EditorView,
    Prec,
    keymap,
    drawSelection,
    highlightActiveLine,
    history,
    historyKeymap,
    defaultKeymap,
    indentWithTab,
    markdown,
    markdownLanguage,
    syntaxHighlighting,
    HighlightStyle,
    tags,
    inlineRevealExtension,
    imageBasePathExt,
    embedPinContextExt,
    spellcheckExtension,
  } = mods;

  const highlightStyle = HighlightStyle.define([
    { tag: tags.heading1, fontWeight: "700", fontSize: "1.4em" },
    { tag: tags.heading2, fontWeight: "700", fontSize: "1.25em" },
    { tag: tags.heading3, fontWeight: "700", fontSize: "1.1em" },
    { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "700" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    // Colors are CSS vars (globals.css --cm-*) so the syntax highlight recolors
    // live when data-theme flips. CM compiles HighlightStyle to obfuscated
    // classes that CSS can't target, so the var() must live here.
    { tag: tags.link, color: "var(--cm-link)", textDecoration: "underline" },
    { tag: tags.url, color: "var(--cm-link)" },
    { tag: tags.monospace, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--cm-mono)" },
    { tag: tags.quote, color: "var(--cm-quote)", fontStyle: "italic" },
    { tag: tags.list, color: "var(--cm-list)" },
    { tag: tags.processingInstruction, color: "var(--cm-meta)" },
    { tag: tags.meta, color: "var(--cm-meta)" },
    { tag: tags.comment, color: "var(--cm-meta)", fontStyle: "italic" },
  ]);

  const theme = EditorView.theme({
    "&": {
      fontSize: "0.95rem",
      backgroundColor: "transparent",
      color: "var(--cm-text)",
    },
    ".cm-content": {
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      lineHeight: "1.7",
      padding: "1rem 1.5rem",
      caretColor: "var(--cm-caret)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--cm-caret)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--cm-selection)",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--cm-active-line)",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-line": {
      padding: "0",
    },
  });

  return [
    // history() is omitted when Loro mode is active; LoroUndoPlugin owns undo.
    ...(omitHistory ? [] : [history()]),
    drawSelection(),
    highlightActiveLine(),
    // GFM base so the inline-reveal walk sees Strikethrough / Table nodes.
    // markdown() never rewrites the doc, so the round-trip stays byte-exact.
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(highlightStyle),
    // Chip 2a + 2b: caret-aware marker hide/reveal (decorations + atomicRanges +
    // theme) plus the block / image widgets and the markdown keymap. Spread
    // AFTER the markdown language so the keymap (Prec.high) wins. The
    // image-base-path facet configures the image widget's blob resolution.
    imageBasePathExt(imageBasePath),
    // Markdown embed hybrid P7-1a: the doc-level pin context facet. Undefined on
    // every non-pin surface, so the embed widget renders live with no pin control.
    embedPinContextExt(embedPinContext),
    // Code-block language picker override. Registered at Prec.highest so it wins
    // over the inline-reveal markdown keymap's own Mod-Shift-c binding (Prec.high)
    // and opens the searchable language picker instead of inserting a bare fence.
    // The handler returns false when the caret is already inside a fenced block,
    // letting the toggle/unfence path below run as before.
    ...(editable && onRequestCodeBlock
      ? [Prec.highest(keymap.of([{ key: "Mod-Shift-c", run: onRequestCodeBlock }]))]
      : []),
    inlineRevealExtension,
    // Spell-check (optional): only when the user enabled it AND the surface is
    // editable (no point underlining words you can't fix). Additive and fully
    // self-contained; the linter is wrapped so it can never break typing.
    ...(editable && spellcheckEnabled() ? [spellcheckExtension()] : []),
    EditorView.lineWrapping,
    theme,
    EditorState.readOnly.of(!editable),
    EditorView.editable.of(editable),
    // historyKeymap is omitted in Loro mode (no CM6 undo stack to drive).
    keymap.of(omitHistory ? [...defaultKeymap, indentWithTab] : [...defaultKeymap, ...historyKeymap, indentWithTab]),
  ];
}

export default function InlineMarkdownEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
  saveRef,
  insertRef,
  onExplicitSave,
  onDirtyChange,
  measureClass,
  imageBasePath,
  embedPinContext,
  loroHandle,
  loroEntryIndex = 0,
  loroBaseNote,
  collabEphemeral,
  collabUser,
  onRequestReference,
  normalizeRef,
}: InlineMarkdownEditorProps) {
  // loroActive is stable after mount: when a handle is provided, the editor is
  // in Loro mode for its entire lifetime. We compute it once from the prop
  // (truthy/falsy) rather than re-reading the ref, so React sees a stable bool.
  // The handle is either a note handle or an experiment-collab task surface
  // handle, both behind the shared EditorLoroHandle shape.
  const loroActive = !!loroHandle;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<import("@codemirror/view").EditorView | null>(null);
  const modsRef = useRef<CMModules | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Code-block language picker. Open when the user triggers "insert code block"
  // on a range that is NOT already inside a fence (Mod-Shift-c, or the Style
  // Guide "Code block" entry). The picker is anchored near the caret; on select
  // we splice the fenced block with the chosen language onto the opening fence
  // so the preview colorizes it. selFrom/selTo capture the range the fence will
  // wrap (the caret's selection at trigger time) since the editor may blur while
  // the picker holds focus.
  const [codeBlockPicker, setCodeBlockPicker] = useState<
    { top: number; left: number; from: number; to: number } | null
  >(null);

  // Mirror the callback props into refs so the CM6 update listener (created
  // once at mount) always sees the latest callbacks without re-binding the
  // whole editor.
  const onChangeRef = useRef(onChange);
  const onExplicitSaveRef = useRef(onExplicitSave);
  const onDirtyChangeRef = useRef(onDirtyChange);
  // Reference picker callback (Chemistry Phase 3). Absent on all existing call
  // sites; only the opt-in surfaces pass this. Mirrored into a ref like the
  // other callbacks so the once-built updateListener always sees the live fn.
  const onRequestReferenceRef = useRef(onRequestReference);
  // Chip 2b: mirror imageBasePath into a ref so the once-at-mount makeState can
  // read the current value (and the disabled-reconfigure picks up a later swap)
  // without re-binding the whole editor or destabilizing makeState.
  const imageBasePathRef = useRef(imageBasePath);
  // Markdown embed hybrid P7-1a: mirror the pin context into a ref so the
  // once-at-mount makeState reads the current value without re-binding the editor.
  const embedPinContextRef = useRef(embedPinContext);

  // Loro mode: hold all Loro props in latest-value refs so the updateListener
  // (created once at mount) and the entry-switch effect always read fresh values
  // without their unstable per-render identities appearing in dep arrays. If the
  // updateListener captured loroBaseNote by closure it would trigger a
  // rebuild-on-keystroke hang -- the note object changes identity on every
  // render as the parent rebuilds it on each key.
  const loroHandleRef = useRef(loroHandle);
  const loroEntryIndexRef = useRef(loroEntryIndex);
  const loroBaseNoteRef = useRef(loroBaseNote);
  // Live collab cursor refs. The EphemeralStore instance is stable (created once
  // by useCollabSession and never re-created), so it is safe to hold in a ref
  // and read at makeState call time without the buildExtensions callback needing
  // to change. collabUser carries a stable shape (name + colorClassName).
  const collabEphemeralRef = useRef(collabEphemeral);
  const collabUserRef = useRef(collabUser);
  // Track the previous entry index to skip the initial-mount fire in the
  // entry-switch effect.
  const prevEntryIndexRef = useRef(loroEntryIndex);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onExplicitSaveRef.current = onExplicitSave;
  }, [onExplicitSave]);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onRequestReferenceRef.current = onRequestReference;
  }, [onRequestReference]);
  useEffect(() => {
    imageBasePathRef.current = imageBasePath;
  }, [imageBasePath]);
  useEffect(() => {
    embedPinContextRef.current = embedPinContext;
  }, [embedPinContext]);
  // Keep Loro refs in sync on every render (same pattern as onChangeRef).
  // Mutating refs during render is safe: refs do not trigger re-renders.
  loroHandleRef.current = loroHandle;
  loroEntryIndexRef.current = loroEntryIndex;
  loroBaseNoteRef.current = loroBaseNote;
  // Keep collab refs in sync. The EphemeralStore instance is stable across
  // renders (never re-created by useCollabSession), so this is just belt-and-
  // suspenders for the session-stop case where collabEphemeral goes undefined.
  collabEphemeralRef.current = collabEphemeral;
  collabUserRef.current = collabUser;

  // Dirty flag: flips true on the first user edit after a mount / external
  // value swap / save.
  const dirtyRef = useRef(false);
  // The last document string the editor itself last accepted: either the most
  // recent external `value` we reconciled to, or the most recent value we
  // emitted via onChange. Used to (a) echo-guard the value-in effect and (b)
  // detect external swaps.
  const lastAcceptedRef = useRef(value);
  // Whether an in-flight dispatch is one WE initiated to reconcile an external
  // value (so the update listener does not bounce it back through onChange).
  const echoingRef = useRef(false);
  // Last `disabled` value the mounted view was built with, so the read-only
  // reconfigure effect only fires on an ACTUAL change (not the initial mount,
  // which already builds with the correct editability).
  const prevDisabledRef = useRef(disabled);

  // Tracks whether a collab session is currently wired into this editor, so the
  // collab-reconfigure effect below fires only when the session turns on/off
  // (not on the initial mount).
  const prevCollabActiveRef = useRef<boolean>(!!collabEphemeral && !!collabUser);

  const setDirty = useCallback((next: boolean) => {
    if (dirtyRef.current !== next) {
      dirtyRef.current = next;
      onDirtyChangeRef.current?.(next);
    }
  }, []);

  // Open the code-block language picker for a CM6 view. Returns true (key
  // handled) when it opens the picker, false to let the base keymap's
  // toggle/unfence path run instead. We open the picker only on the FENCE half
  // of the toggle (the caret is NOT inside an existing fenced block) and only
  // for a single selection range, since a picker is one language decision; a
  // multi-cursor selection or an in-fence caret falls through to the base
  // fencedCodeCommand (unchanged). The caret's viewport coords anchor the popup.
  const openCodeBlockPicker = useCallback(
    (view: import("@codemirror/view").EditorView): boolean => {
      const sel = view.state.selection;
      if (sel.ranges.length !== 1) return false;
      const range = sel.main;
      // Inside an existing fence -> let the base command UNFENCE (the toggle).
      if (detectUnfence(view.state, range)) return false;
      const coords = view.coordsAtPos(range.head);
      // Anchor just below the caret; fall back to the editor's top-left when CM6
      // cannot resolve coords (e.g. the position is scrolled out of view).
      const hostRect = hostRef.current?.getBoundingClientRect();
      const top = coords ? coords.bottom + 4 : (hostRect?.top ?? 0) + 24;
      const left = coords ? coords.left : (hostRect?.left ?? 0) + 24;
      // Keep the popup on-screen near the right edge (its width is 16rem = 256px).
      const maxLeft = Math.max(8, window.innerWidth - 256 - 8);
      setCodeBlockPicker({
        top,
        left: Math.min(left, maxLeft),
        from: range.from,
        to: range.to,
      });
      return true;
    },
    [],
  );
  // The keymap is built once inside makeState; it reads the live picker-open
  // handler through this ref so the binding never needs rebinding.
  const openCodeBlockPickerRef = useRef(openCodeBlockPicker);
  openCodeBlockPickerRef.current = openCodeBlockPicker;

  // Splice the fenced block with the chosen language onto the captured range,
  // then close the picker and refocus the editor with the caret inside the
  // block. The language is written onto the opening fence (```<lang>) so the
  // rehypeHighlight preview colorizes it; PLAIN_TEXT_CODE yields a bare ```
  // fence. Flows through the same updateListener as any edit (onChange + dirty).
  const insertFencedCode = useCallback(
    (code: string) => {
      const view = viewRef.current;
      const picker = codeBlockPicker;
      setCodeBlockPicker(null);
      if (!view || !picker) return;
      const selectedText = view.state.sliceDoc(picker.from, picker.to);
      const { insert, selFrom, selTo } = buildFencedCodeInsertion(selectedText, code);
      view.dispatch({
        changes: { from: picker.from, to: picker.to, insert },
        selection:
          selFrom === selTo
            ? { anchor: picker.from + selFrom }
            : { anchor: picker.from + selFrom, head: picker.from + selTo },
        scrollIntoView: true,
        userEvent: "input.wrap",
      });
      view.focus();
    },
    [codeBlockPicker],
  );

  // Cancel the picker without inserting and return focus to the editor.
  const cancelCodeBlockPicker = useCallback(() => {
    setCodeBlockPicker(null);
    viewRef.current?.focus();
  }, []);

  // Build a fresh EditorState wired with the manual-save listeners + keymap +
  // syntax-highlight extension set. Shared by the initial mount AND the
  // `disabled` reconfigure so the two paths never drift. All closed-over
  // dependencies are stable refs / the stable setDirty, so this callback is
  // itself stable.
  //
  // In Loro mode (loroActive):
  //   - `doc` is seeded from the Loro text (caller passes the result of
  //     getEntryContentText().toString()) so the initial state matches Loro and
  //     LoroSyncPlugin sees no divergence on first sync.
  //   - loroHandle.bindEditorExtension() is appended; it bundles LoroSyncPlugin +
  //     LoroEphemeralPlugin + LoroUndoPlugin.
  //   - history() + historyKeymap are omitted; LoroUndoPlugin owns undo.
  //   - The updateListener also debounced-commits through the handle.
  //   - Cmd+S additionally flushes the handle so an explicit save drains immediately.
  const makeState = useCallback(
    (mods: CMModules, doc: string, editable: boolean): EditorStateType => {
      // updateListener drives the manual-save contract: fire onChange + dirty
      // ONLY on a real doc change that WE did not initiate as an echo.
      // In Loro mode, additionally kick the debounced persist through the handle.
      // Do NOT add a second updateListener for the Loro path; extend this one.
      const updateListener = mods.EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        if (echoingRef.current) return;

        // Reference picker slash trigger (Chemistry Phase 3). When the user
        // types "/" as a single character at a word boundary (start of the doc,
        // or preceded by whitespace / newline), fire the reference picker and
        // remove the "/" from the document. This mirrors how many editors (Notion,
        // Linear) open a command menu on "/". The check is deliberately simple
        // and conservative: only fires on a plain "/" single-char insert on a
        // single selection range, never inside a code fence or an existing URL.
        // The guard reads the ref so this once-built listener always sees the
        // latest callback without needing to rebuild.
        const requestRef = onRequestReferenceRef.current;
        if (requestRef) {
          // Check: exactly one change (the "/" insert), exactly one selection range.
          const changes = update.changes;
          const sel = update.state.selection;
          if (sel.ranges.length === 1) {
            let singleSlash = false;
            let insertPos = -1;
            changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              // A single "/" insertion with no deletion (toA === fromA).
              if (fromA === toA && inserted.toString() === "/") {
                singleSlash = true;
                insertPos = fromA;
              }
            });
            if (singleSlash && insertPos >= 0) {
              // Check that the character immediately before the "/" is whitespace,
              // a newline, or the doc starts at this position — i.e., a word boundary.
              const doc = update.state.doc;
              const atBoundary =
                insertPos === 0 ||
                /[\s\n]/.test(doc.sliceString(insertPos - 1, insertPos));
              if (atBoundary) {
                // Remove the "/" from the doc (undo the insert) then open the picker.
                // Use echoingRef to suppress the re-fire of onChange/dirty for this
                // cleanup dispatch, just as we do for external value reconciliation.
                const view = (update as { view?: import("@codemirror/view").EditorView }).view;
                if (view) {
                  echoingRef.current = true;
                  try {
                    view.dispatch({
                      changes: { from: insertPos, to: insertPos + 1, insert: "" },
                    });
                  } finally {
                    echoingRef.current = false;
                  }
                  // Fire the reference picker callback.
                  requestRef();
                  return; // Skip the normal onChange/dirty path for this update.
                }
              }
            }
          }
        }

        const next = update.state.doc.toString();
        lastAcceptedRef.current = next;
        setDirty(true);
        onChangeRef.current?.(next);
        // Loro mode: debounced-commit. loroBaseNoteRef holds the latest Note
        // identity without appearing in the dep array (see ref comment above).
        // The note path always carries a base (its mirror projection needs it);
        // a task surface has no base and its handle ignores the argument, so we
        // commit whenever a handle is bound.
        if (loroHandleRef.current) {
          void loroHandleRef.current.commit(loroBaseNoteRef.current as Note);
        }
      });
      // Cmd/Ctrl+S -> explicit save. CM6 keymaps receive the EditorView; read
      // the document straight off state and clear dirty. Returning true marks
      // the key handled (so the browser Save dialog never opens).
      // In Loro mode, also flush the handle so the pending debounce drains now.
      const saveKeymap = mods.keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: (v) => {
            const d = v.state.doc.toString();
            lastAcceptedRef.current = d;
            setDirty(false);
            onExplicitSaveRef.current?.(d);
            if (loroHandleRef.current) {
              void loroHandleRef.current.flush();
            }
            return true;
          },
        },
      ]);

      // In Loro mode, append the Loro extension after the base extensions.
      // LoroSyncPlugin is always included when a handle is present.
      // LoroEphemeralPlugin (via safeLoroEphemeralPlugin inside bindEditorExtension)
      // is included only when both collabEphemeral and collabUser are present,
      // meaning a live collab session is active. Flag-off or no-session means the
      // ephemeral refs are undefined and bindEditorExtension falls back to sync-only.
      // Both handle shapes expose bindEditorExtension(activeIndex, ephemeral,
      // user). A task surface ignores the index (single text); the popup passes
      // 0 for it.
      const loroExtension =
        loroHandleRef.current
          ? [loroHandleRef.current.bindEditorExtension(
              loroEntryIndexRef.current,
              collabEphemeralRef.current,
              collabUserRef.current,
            )]
          : [];

      // Mod-Shift-c override: open the language picker on the FENCE half of the
      // toggle. Reads the live handler through the ref so the once-built keymap
      // never needs rebinding.
      const requestCodeBlock = (view: import("@codemirror/view").EditorView) =>
        openCodeBlockPickerRef.current(view);

      return mods.EditorState.create({
        doc,
        extensions: [
          saveKeymap,
          updateListener,
          // CM6 history() stays ON in Loro mode too: the Loro binding is
          // sync-only (no LoroUndoPlugin), so CodeMirror owns undo.
          ...buildExtensions(
            mods,
            editable,
            imageBasePathRef.current,
            requestCodeBlock,
            false,
            embedPinContextRef.current,
          ),
          ...loroExtension,
        ],
      });
    },
    // loroActive is stable for the lifetime of the component (determined at
    // mount from whether loroHandle is provided); safe to include in deps.
    [setDirty, loroActive],
  );

  // Dynamically import the CM6 packages, then mount the EditorView. The whole
  // import keeps the editor bundle off every non-Notes surface. useLayoutEffect
  // so the view attaches before paint once the chunk has resolved; the async
  // import is awaited inside.
  useLayoutEffect(() => {
    let cancelled = false;

    void (async () => {
      const [
        stateMod,
        viewMod,
        commandsMod,
        langMod,
        languageMod,
        highlightMod,
        inlineRevealMod,
        spellcheckMod,
      ] = await Promise.all([
        import("@codemirror/state"),
        import("@codemirror/view"),
        import("@codemirror/commands"),
        import("@codemirror/lang-markdown"),
        import("@codemirror/language"),
        import("@lezer/highlight"),
        import("@/lib/markdown/cm-inline-reveal/inline-reveal"),
        import("@/lib/markdown/cm-spellcheck/spellcheck"),
      ]);
      if (cancelled) return;

      const mods: CMModules = {
        EditorState: stateMod.EditorState,
        EditorView: viewMod.EditorView,
        Prec: stateMod.Prec,
        keymap: viewMod.keymap,
        drawSelection: viewMod.drawSelection,
        highlightActiveLine: viewMod.highlightActiveLine,
        history: commandsMod.history,
        historyKeymap: commandsMod.historyKeymap,
        defaultKeymap: commandsMod.defaultKeymap,
        indentWithTab: commandsMod.indentWithTab,
        markdown: langMod.markdown,
        markdownLanguage: langMod.markdownLanguage,
        syntaxHighlighting: languageMod.syntaxHighlighting,
        HighlightStyle: languageMod.HighlightStyle,
        tags: highlightMod.tags,
        inlineRevealExtension: inlineRevealMod.inlineRevealExtension,
        imageBasePathExt: inlineRevealMod.imageBasePathExt,
        embedPinContextExt: inlineRevealMod.embedPinContextExt,
        spellcheckExtension: spellcheckMod.spellcheckExtension,
      };
      modsRef.current = mods;

      const host = hostRef.current;
      if (!host) return;

      // In Loro mode, seed the EditorState doc from the active entry's Loro
      // text so the initial state matches Loro exactly. LoroSyncPlugin (inside
      // bindEditorExtension) keeps them in sync after mount; seeding from the
      // Loro text avoids an initial divergence that would cause a double-write.
      // Reconcile the entry set first (defensive: the note may have gained an
      // entry between openNote and this mount) so the bound index exists.
      // In normal mode, seed from the controlled `value` prop as before.
      if (loroActive && loroBaseNoteRef.current) {
        loroHandleRef.current!.ensureEntries?.(loroBaseNoteRef.current);
      }
      // Seed from the active Loro text so LoroSyncPlugin sees no first-sync
      // divergence. Note handle -> entry projection; task handle -> the single
      // "content" text (via editorSeedText). Falls back to the controlled
      // `value` in non-Loro mode.
      const seedDoc = loroActive
        ? seedTextForHandle(loroHandleRef.current!, loroEntryIndexRef.current)
        : value;

      const view = new mods.EditorView({
        state: makeState(mods, seedDoc, !disabled),
        parent: host,
      });
      viewRef.current = view;
      lastAcceptedRef.current = seedDoc;
      prevDisabledRef.current = disabled;
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // Mount once: value-in reconciliation and disabled changes are handled by
    // the dedicated effects below, so this effect intentionally has no deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Publish the imperative save flush on saveRef. Returns the latest doc string
  // synchronously (no async controlled-value round-trip) and clears dirty, so a
  // parent Save button can persist immediately.
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = () => {
      const view = viewRef.current;
      const doc = view ? view.state.doc.toString() : value;
      lastAcceptedRef.current = doc;
      setDirty(false);
      onChangeRef.current?.(doc);
      return doc;
    };
    return () => {
      if (saveRef) saveRef.current = null;
    };
    // value is captured only as the pre-mount fallback; the live read comes
    // from viewRef, so we don't want to re-run on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveRef]);

  // Publish the imperative insert on insertRef (mirrors saveRef above). Splices
  // the given syntax in at the current selection via a single CM6 dispatch:
  // replaceSelection inserts the text (overwriting any selection) and moves the
  // caret to the end of the insert, so the change flows through the same
  // updateListener that drives onChange + dirty (no echo guard needed: this IS
  // a real user-initiated edit). Refocuses so the user keeps typing inline.
  // Null-safe: no-op until the view has mounted. Cleared on unmount.
  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (syntax: string) => {
      const view = viewRef.current;
      if (!view) return;
      // The Style Guide "Code block" entry routes through here. Intercept it so
      // the toolbar opens the SAME language picker the keyboard shortcut does
      // instead of splicing a bare fence. If the picker cannot open (caret
      // inside an existing fence, or a multi-cursor selection), fall through to
      // the literal insert below so the click still does something sensible.
      if (isCodeBlockInsertSyntax(syntax) && openCodeBlockPickerRef.current(view)) {
        return;
      }
      // A block embed only renders as a card when it is alone in its paragraph,
      // so an embed inserted mid-line would show as an inline chip. Give it its
      // own line (blank line above + below) and leave the caret on the line
      // below, so it renders as a block immediately instead of as raw source.
      if (isBlockEmbedMarkdown(syntax)) {
        const sel = view.state.selection.main;
        const before = view.state.doc.sliceString(0, sel.from);
        const after = view.state.doc.sliceString(sel.to);
        const lead =
          before.length === 0 || before.endsWith("\n\n")
            ? ""
            : before.endsWith("\n")
              ? "\n"
              : "\n\n";
        // Always leave a line below so the caret lands off the embed (a caret on
        // the embed line would reveal its source). At doc end one newline is
        // enough; otherwise ensure a blank line before any following text.
        const trail = after.length === 0 ? "\n" : after.startsWith("\n") ? "\n" : "\n\n";
        view.dispatch(view.state.replaceSelection(lead + syntax + trail));
        view.focus();
        return;
      }
      view.dispatch(view.state.replaceSelection(syntax));
      view.focus();
    };
    return () => {
      if (insertRef) insertRef.current = null;
    };
  }, [insertRef]);

  // P7-2 transclusion normalize. Publish an async function on normalizeRef that
  // reads the current CM6 doc, resolves note titles via notesApi.list(), runs
  // normalizeTransclusions, and (when something changed) dispatches a single
  // full-doc CM6 replace so the change flows through LoroSyncPlugin / onChange
  // into storage. The dispatch uses the same echoingRef guard that value-in
  // reconciliation uses, so the updateListener treats it as an "accepted" edit
  // (not a new user keystroke). A list-fetch failure is swallowed silently: the
  // resolve function returns null for every title, normalizeTransclusions leaves
  // every ![[]] raw, and changed is false so no dispatch fires.
  //
  // Works in both Loro and legacy modes: in Loro mode, LoroSyncPlugin intercepts
  // the dispatch and writes it into the CRDT (then the Loro flush persists it);
  // in legacy mode, onChange fires as with any user edit and the legacy writer
  // picks it up.  Callers AWAIT normalizeRef.current() BEFORE persistEntryContent
  // so the persisted content carries the portable links.
  useEffect(() => {
    if (!normalizeRef) return;
    normalizeRef.current = async () => {
      const view = viewRef.current;
      if (!view) return;
      const text = view.state.doc.toString();
      if (!text.includes("![[")) return;
      // Build the title->id resolver from the current notes list.
      let all: Awaited<ReturnType<typeof notesApi.list>> = [];
      try {
        all = await notesApi.list();
      } catch {
        return; // List unavailable: leave every transclusion raw.
      }
      const byTitle = new Map<string, string>();
      for (const n of all) {
        const key = (n.title ?? "").trim().toLowerCase();
        if (!key) continue;
        if (!byTitle.has(key)) byTitle.set(key, String(n.id));
      }
      const { content: next, changed } = normalizeTransclusions(text, (title) => {
        return byTitle.get(title.trim().toLowerCase()) ?? null;
      });
      if (!changed) return;
      // Dispatch the normalized content as a full-doc replace. Use the echo guard
      // so the updateListener recognises it as an accepted reconcile (not a raw
      // user keystroke) and correctly updates lastAcceptedRef.
      echoingRef.current = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
        });
      } finally {
        echoingRef.current = false;
      }
      // Keep lastAccepted and onChange in sync: the echo guard suppresses the
      // updateListener's own emit, so we push the new value manually.
      lastAcceptedRef.current = next;
      onChangeRef.current?.(next);
    };
    return () => {
      if (normalizeRef) normalizeRef.current = null;
    };
  }, [normalizeRef]);

  // Value-in reconciliation: when the parent swaps `value` to something that
  // differs from what the editor last accepted (an EXTERNAL change, e.g. the
  // note tab switched), replace the document. The echo guard prevents our own
  // updateListener from treating this dispatch as a user edit. Skipping when
  // value === lastAccepted avoids re-dispatching our own emitted value.
  //
  // SKIPPED in Loro mode: LoroSyncPlugin owns the document and is the single
  // source of truth. Dispatching an external `value` into a Loro-bound editor
  // would fight LoroSyncPlugin (it would immediately revert the dispatch to
  // match the Loro text). The guard runs AFTER all hooks so hook order is stable.
  useEffect(() => {
    if (loroActive) return;
    if (!loaded) return;
    const view = viewRef.current;
    if (!view) return;
    if (value === lastAcceptedRef.current) return;
    if (value === view.state.doc.toString()) {
      lastAcceptedRef.current = value;
      return;
    }
    echoingRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    } finally {
      echoingRef.current = false;
    }
    lastAcceptedRef.current = value;
    // An external swap resets the clean baseline.
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, loaded]);

  // Entry-switch effect (Loro mode only): when loroEntryIndex changes after
  // mount, rebuild the EditorState so the editor rebinds to the new entry's
  // LoroText. We call makeState with the new entry's seed text and the current
  // editability, mirroring the disabled-reconfigure effect above.
  // Deps: ONLY [loroEntryIndex, loaded] -- NOT loroBaseNote or onChange (those
  // are read from refs inside makeState/updateListener to avoid the rebuild-hang).
  useEffect(() => {
    if (!loroActive) return;
    if (!loaded) return;
    // Skip the initial mount (prevEntryIndexRef starts at loroEntryIndex).
    if (prevEntryIndexRef.current === loroEntryIndex) return;
    prevEntryIndexRef.current = loroEntryIndex;
    const view = viewRef.current;
    const mods = modsRef.current;
    if (!view || !mods) return;
    const handle = loroHandleRef.current;
    if (!handle) return;
    // The target entry may be NEW (added via the legacy UI after this note's
    // doc was seeded), in which case it is not in the doc yet and binding to it
    // would crash. Reconcile the entry set first so the entry exists.
    if (loroBaseNoteRef.current) handle.ensureEntries?.(loroBaseNoteRef.current);
    // Seed from the new entry's Loro text.
    const newSeed = seedTextForHandle(handle, loroEntryIndex);
    view.setState(makeState(mods, newSeed, !disabled));
    lastAcceptedRef.current = newSeed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loroEntryIndex, loaded]);

  // Reflect a CHANGE to `disabled` into CM6's editable state without
  // remounting the component (which would wipe this editor's own undo stack).
  // We rebuild the full state via makeState so EditorState.readOnly +
  // EditorView.editable track `disabled`, preserving the live document. The
  // CM6 history() stack resets across this reconfigure, which is acceptable
  // because toggling read-only is a deliberate mode change, not a per-keystroke
  // event. The prevDisabledRef guard skips the initial mount (already built
  // with the correct editability).
  useEffect(() => {
    if (!loaded) return;
    if (prevDisabledRef.current === disabled) return;
    prevDisabledRef.current = disabled;
    const view = viewRef.current;
    const mods = modsRef.current;
    if (!view || !mods) return;
    view.setState(makeState(mods, view.state.doc.toString(), !disabled));
  }, [disabled, loaded, makeState]);

  // Reflect a collab session turning ON or OFF into the live editor. The
  // editor's extensions (LoroSyncPlugin, and now LoroEphemeralPlugin for
  // cursors) are built once in makeState at mount, when no session exists yet.
  // A session goes live AFTER mount (the user clicks Collaborate / Join), which
  // updates collabEphemeralRef/collabUserRef but does NOT rebuild the CM6 state,
  // so the cursor plugin would never be installed. This effect rebuilds the
  // state when the collab-active flag flips, so bindEditorExtension re-runs and
  // adds (or drops, on Stop) the ephemeral cursor layer. Same reconfigure shape
  // as the disabled effect above: it preserves the live document and is a
  // deliberate mode change, so the CM6 undo stack reset is acceptable.
  const collabActive = !!collabEphemeral && !!collabUser;
  useEffect(() => {
    if (!loaded) return;
    if (prevCollabActiveRef.current === collabActive) return;
    prevCollabActiveRef.current = collabActive;
    const view = viewRef.current;
    const mods = modsRef.current;
    if (!view || !mods) return;
    view.setState(makeState(mods, view.state.doc.toString(), !disabled));
  }, [collabActive, disabled, loaded, makeState]);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className={measureClass ?? "w-full"}>
        <div
          ref={hostRef}
          data-testid="inline-markdown-editor"
          className="cm-inline-editor light-scope min-h-[12rem] rounded-md border border-border bg-surface-raised"
        />
        {!loaded && (
          <p className="px-6 py-4 text-body text-foreground-muted italic">
            {placeholder ? `Loading editor for: ${placeholder}` : "Loading editor..."}
          </p>
        )}
      </div>
      {/* Code-block language picker (fixed-position overlay anchored at the
          caret). Open only while inserting a fenced block. */}
      {codeBlockPicker && (
        <CodeLanguagePicker
          position={{ top: codeBlockPicker.top, left: codeBlockPicker.left }}
          onSelect={insertFencedCode}
          onCancel={cancelCodeBlockPicker}
        />
      )}
    </div>
  );
}
