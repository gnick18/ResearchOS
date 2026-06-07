"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorState as EditorStateType } from "@codemirror/state";
import type { NoteHandle } from "@/lib/loro/store";
import type { TaskDocHandle } from "@/lib/loro/task-store";
import type { Note } from "@/lib/types";
import type { EphemeralStore } from "loro-crdt";
import type { UserState, EphemeralState } from "loro-codemirror";
import { getEntryContentText } from "@/lib/loro/note-doc";
import { getTaskContentText } from "@/lib/loro/task-doc";

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
};

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

  // ---------------------------------------------------------------------------
  // Loro CRDT pilot (additive; when absent the editor behaves exactly as today)
  // ---------------------------------------------------------------------------
  /** When set, the editor runs in Loro mode: seeds from the Loro text, binds
   *  LoroExtensions (sync + ephemeral + undo), drops CM6 history(), and commits
   *  through the handle on every change. When absent, no behaviour changes. */
  loroHandle?: NoteHandle;
  /** Which entry inside the note doc to bind. Defaults to 0. */
  loroEntryIndex?: number;
  /** The live Note object. The commit() call reads it from a ref so a
   *  per-render-new identity never destabilises the updateListener. */
  loroBaseNote?: Note;
  /**
   * Experiment-collab chunk 1: when set, the editor runs in Loro mode against a
   * task's single-text markdown surface (Lab Notes / Results) instead of a
   * note's entry projection. Mutually exclusive with loroHandle. The task
   * handle seeds from the doc's "content" text, commits with no base argument,
   * and has no entry set to reconcile (single text), so the note-specific
   * ensureEntries / entry-index paths are skipped on this branch.
   */
  loroTaskHandle?: TaskDocHandle;

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
  // When true, omit history() + historyKeymap because LoroUndoPlugin (bundled
  // inside bindEditorExtension) owns undo. Running both double-applies undo.
  omitHistory = false,
) {
  const {
    EditorState,
    EditorView,
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
    inlineRevealExtension,
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
  loroHandle,
  loroEntryIndex = 0,
  loroBaseNote,
  loroTaskHandle,
  collabEphemeral,
  collabUser,
}: InlineMarkdownEditorProps) {
  // loroActive is stable after mount: when a handle is provided, the editor is
  // in Loro mode for its entire lifetime. We compute it once from the prop
  // (truthy/falsy) rather than re-reading the ref, so React sees a stable bool.
  // loroActive covers BOTH the note handle and the experiment-collab task
  // handle (single-text surface). Either one puts the editor into Loro mode.
  const loroActive = !!loroHandle || !!loroTaskHandle;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<import("@codemirror/view").EditorView | null>(null);
  const modsRef = useRef<CMModules | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Mirror the callback props into refs so the CM6 update listener (created
  // once at mount) always sees the latest callbacks without re-binding the
  // whole editor.
  const onChangeRef = useRef(onChange);
  const onExplicitSaveRef = useRef(onExplicitSave);
  const onDirtyChangeRef = useRef(onDirtyChange);
  // Chip 2b: mirror imageBasePath into a ref so the once-at-mount makeState can
  // read the current value (and the disabled-reconfigure picks up a later swap)
  // without re-binding the whole editor or destabilizing makeState.
  const imageBasePathRef = useRef(imageBasePath);

  // Loro mode: hold all Loro props in latest-value refs so the updateListener
  // (created once at mount) and the entry-switch effect always read fresh values
  // without their unstable per-render identities appearing in dep arrays. If the
  // updateListener captured loroBaseNote by closure it would trigger a
  // rebuild-on-keystroke hang -- the note object changes identity on every
  // render as the parent rebuilds it on each key.
  const loroHandleRef = useRef(loroHandle);
  const loroEntryIndexRef = useRef(loroEntryIndex);
  const loroBaseNoteRef = useRef(loroBaseNote);
  const loroTaskHandleRef = useRef(loroTaskHandle);
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
    imageBasePathRef.current = imageBasePath;
  }, [imageBasePath]);
  // Keep Loro refs in sync on every render (same pattern as onChangeRef).
  // Mutating refs during render is safe: refs do not trigger re-renders.
  loroHandleRef.current = loroHandle;
  loroEntryIndexRef.current = loroEntryIndex;
  loroBaseNoteRef.current = loroBaseNote;
  loroTaskHandleRef.current = loroTaskHandle;
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
        const next = update.state.doc.toString();
        lastAcceptedRef.current = next;
        setDirty(true);
        onChangeRef.current?.(next);
        // Loro mode: debounced-commit. loroBaseNoteRef holds the latest Note
        // identity without appearing in the dep array (see ref comment above).
        if (loroHandleRef.current && loroBaseNoteRef.current) {
          void loroHandleRef.current.commit(loroBaseNoteRef.current);
        }
        // Experiment-collab chunk 1: the task handle's commit takes no base
        // (single-text surface, no note-level stamping), so it does not depend
        // on loroBaseNoteRef.
        if (loroTaskHandleRef.current) {
          void loroTaskHandleRef.current.commit();
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
            if (loroTaskHandleRef.current) {
              void loroTaskHandleRef.current.flush();
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
      // user). The task handle ignores the index (single text); we pass 0.
      const activeLoroHandle = loroHandleRef.current ?? loroTaskHandleRef.current;
      const loroExtension =
        activeLoroHandle
          ? [activeLoroHandle.bindEditorExtension(
              loroHandleRef.current ? loroEntryIndexRef.current : 0,
              collabEphemeralRef.current,
              collabUserRef.current,
            )]
          : [];

      return mods.EditorState.create({
        doc,
        extensions: [
          saveKeymap,
          updateListener,
          // CM6 history() stays ON in Loro mode too: the Loro binding is
          // sync-only (no LoroUndoPlugin), so CodeMirror owns undo.
          ...buildExtensions(mods, editable, imageBasePathRef.current),
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
      ] = await Promise.all([
        import("@codemirror/state"),
        import("@codemirror/view"),
        import("@codemirror/commands"),
        import("@codemirror/lang-markdown"),
        import("@codemirror/language"),
        import("@lezer/highlight"),
        import("@/lib/markdown/cm-inline-reveal/inline-reveal"),
      ]);
      if (cancelled) return;

      const mods: CMModules = {
        EditorState: stateMod.EditorState,
        EditorView: viewMod.EditorView,
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
      if (loroHandleRef.current && loroBaseNoteRef.current) {
        loroHandleRef.current.ensureEntries(loroBaseNoteRef.current);
      }
      // Seed from the active Loro text so LoroSyncPlugin sees no first-sync
      // divergence. Note handle -> entry projection; task handle -> the single
      // "content" text. Falls back to the controlled `value` in non-Loro mode.
      const seedDoc = loroTaskHandleRef.current
        ? getTaskContentText(loroTaskHandleRef.current.doc)
        : loroHandleRef.current
          ? (getEntryContentText(loroHandleRef.current.doc, loroEntryIndexRef.current)?.toString() ?? "")
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
      view.dispatch(view.state.replaceSelection(syntax));
      view.focus();
    };
    return () => {
      if (insertRef) insertRef.current = null;
    };
  }, [insertRef]);

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
    if (loroBaseNoteRef.current) handle.ensureEntries(loroBaseNoteRef.current);
    // Seed from the new entry's Loro text.
    const newSeed = getEntryContentText(handle.doc, loroEntryIndex)?.toString() ?? "";
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
    </div>
  );
}
