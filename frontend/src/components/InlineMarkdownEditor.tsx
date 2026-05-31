"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorState as EditorStateType } from "@codemirror/state";

/**
 * Inline ("Typora-style") Markdown editor — Typora editor chip 1 (T1 + T2).
 *
 * This is the OPT-IN third editor surface (EditorMode "inline") that mounts a
 * CodeMirror 6 EditorView whose DOCUMENT IS THE MARKDOWN TEXT. CM6 never
 * re-serializes the source: every "render" is a view-only decoration, so the
 * local-first round-trip contract is structurally guaranteed (proven by
 * InlineMarkdownEditor.roundtrip.test.tsx — the go/no-go gate). Our markdown
 * dialect (single-underscore underline, literal <u>, <!-- stamp --> comments,
 * raw <img>, GFM) survives byte-for-byte because the editor stores those bytes
 * and only highlights them.
 *
 * CHIP 1 SCOPE (this file): mount + byte-for-byte round-trip + the manual-save
 * contract (saveRef / onExplicitSave / onDirtyChange / value-in-onChange-out)
 * + basic markdown syntax highlighting + the fluid ch-based measure.
 * NO caret-aware marker hiding / inline reveal — that is chip 2
 * (MARKDOWN_EDITOR_TYPORA_INLINE_REVEAL_DESIGN.md). This editor owns its OWN
 * CM6 history() undo stack (it does NOT share HybridMarkdownEditor's
 * ValueHistory) and never autosaves to the parent.
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
  // extends the same extension with the block + image widgets and the
  // hybrid-parity markdown keymap; the plugin stays view-only (the keymap is the
  // only doc-dispatching member, on a user keypress), so the chip 1 round-trip +
  // save contract are untouched.
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
  /** Manual-save contract (same interface as the hybrid child, different impl).
   *  saveRef.current returns the latest doc string synchronously so a parent
   *  Save button can flush + persist. */
  saveRef?: React.MutableRefObject<(() => string) | null>;
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
    { tag: tags.link, color: "#2563eb", textDecoration: "underline" },
    { tag: tags.url, color: "#2563eb" },
    { tag: tags.monospace, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#9333ea" },
    { tag: tags.quote, color: "#6b7280", fontStyle: "italic" },
    { tag: tags.list, color: "#374151" },
    { tag: tags.processingInstruction, color: "#9ca3af" },
    { tag: tags.meta, color: "#9ca3af" },
    { tag: tags.comment, color: "#9ca3af", fontStyle: "italic" },
  ]);

  const theme = EditorView.theme({
    "&": {
      fontSize: "0.95rem",
      backgroundColor: "transparent",
    },
    ".cm-content": {
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      lineHeight: "1.7",
      padding: "1rem 1.5rem",
      caretColor: "#111827",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-line": {
      padding: "0",
    },
  });

  return [
    history(),
    drawSelection(),
    highlightActiveLine(),
    // GFM base so the inline-reveal walk sees Strikethrough / Table nodes.
    // markdown() never rewrites the doc, so the round-trip stays byte-exact.
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(highlightStyle),
    // Chip 2a + 2b: caret-aware marker hide/reveal (decorations + atomicRanges +
    // theme) plus the block / image widgets and the hybrid-parity markdown
    // keymap. Spread AFTER the markdown language so the keymap (Prec.high) wins.
    // The image-base-path facet configures the image widget's blob resolution.
    imageBasePathExt(imageBasePath),
    inlineRevealExtension,
    EditorView.lineWrapping,
    theme,
    EditorState.readOnly.of(!editable),
    EditorView.editable.of(editable),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  ];
}

export default function InlineMarkdownEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
  saveRef,
  onExplicitSave,
  onDirtyChange,
  measureClass,
  imageBasePath,
}: InlineMarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<import("@codemirror/view").EditorView | null>(null);
  const modsRef = useRef<CMModules | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Mirror the callback props into refs so the CM6 update listener (created
  // once at mount) always sees the latest callbacks without re-binding the
  // whole editor. Same pattern HybridMarkdownEditor uses for onExplicitSave.
  const onChangeRef = useRef(onChange);
  const onExplicitSaveRef = useRef(onExplicitSave);
  const onDirtyChangeRef = useRef(onDirtyChange);
  // Chip 2b: mirror imageBasePath into a ref so the once-at-mount makeState can
  // read the current value (and the disabled-reconfigure picks up a later swap)
  // without re-binding the whole editor or destabilizing makeState.
  const imageBasePathRef = useRef(imageBasePath);
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

  // Dirty flag (this editor owns it; NOT shared with the hybrid buffer). Flips
  // true on the first user edit after a mount / external value swap / save.
  const dirtyRef = useRef(false);
  // The last document string the editor itself last accepted: either the most
  // recent external `value` we reconciled to, or the most recent value we
  // emitted via onChange. Used to (a) echo-guard the value-in effect and (b)
  // detect external swaps. Same role as lastAcceptedValueRef in the hybrid.
  const lastAcceptedRef = useRef(value);
  // Whether an in-flight dispatch is one WE initiated to reconcile an external
  // value (so the update listener does not bounce it back through onChange).
  const echoingRef = useRef(false);
  // Last `disabled` value the mounted view was built with, so the read-only
  // reconfigure effect only fires on an ACTUAL change (not the initial mount,
  // which already builds with the correct editability).
  const prevDisabledRef = useRef(disabled);

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
  const makeState = useCallback(
    (mods: CMModules, doc: string, editable: boolean): EditorStateType => {
      // updateListener drives the manual-save contract: fire onChange + dirty
      // ONLY on a real doc change that WE did not initiate as an echo.
      const updateListener = mods.EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        if (echoingRef.current) return;
        const next = update.state.doc.toString();
        lastAcceptedRef.current = next;
        setDirty(true);
        onChangeRef.current?.(next);
      });
      // Cmd/Ctrl+S -> explicit save. CM6 keymaps receive the EditorView; read
      // the document straight off state and clear dirty. Returning true marks
      // the key handled (so the browser Save dialog never opens).
      const saveKeymap = mods.keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: (v) => {
            const d = v.state.doc.toString();
            lastAcceptedRef.current = d;
            setDirty(false);
            onExplicitSaveRef.current?.(d);
            return true;
          },
        },
      ]);
      return mods.EditorState.create({
        doc,
        extensions: [
          saveKeymap,
          updateListener,
          ...buildExtensions(mods, editable, imageBasePathRef.current),
        ],
      });
    },
    [setDirty],
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

      const view = new mods.EditorView({
        state: makeState(mods, value, !disabled),
        parent: host,
      });
      viewRef.current = view;
      lastAcceptedRef.current = value;
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
  // parent Save button can persist immediately. Mirrors HybridMarkdownEditor's
  // saveRef shape.
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

  // Value-in reconciliation: when the parent swaps `value` to something that
  // differs from what the editor last accepted (an EXTERNAL change, e.g. the
  // note tab switched), replace the document. The echo guard prevents our own
  // updateListener from treating this dispatch as a user edit. Skipping when
  // value === lastAccepted avoids re-dispatching our own emitted value.
  useEffect(() => {
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

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className={measureClass ?? "w-full"}>
        <div
          ref={hostRef}
          data-testid="inline-markdown-editor"
          className="cm-inline-editor min-h-[12rem] rounded-md border border-gray-200 bg-white"
        />
        {!loaded && (
          <p className="px-6 py-4 text-sm text-gray-400 italic">
            {placeholder ? `Loading editor for: ${placeholder}` : "Loading editor..."}
          </p>
        )}
      </div>
    </div>
  );
}
