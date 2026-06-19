// Side-effect import that pre-warms the markdown editor's heaviest lazy chunk.
//
// InlineMarkdownEditor lazy-loads its CodeMirror extensions via a dynamic-import
// Promise.all on mount. In a short component test the editor often unmounts
// before that settles, so a chunk finishes transforming and resolves AFTER the
// jsdom environment is torn down, which vitest surfaces as a flaky
// EnvironmentTeardownError that fails the whole run even though every test
// passes. Importing cm-inline-reveal here (at the test file's module-eval, before
// any test runs) seeds the module registry, so the editor's dynamic import()
// resolves from cache within the test, before teardown.
//
// This lives in a per-file helper rather than the global jsdom setup on purpose:
// cm-inline-reveal transitively loads the embed renderer (ObjectEmbed), whose
// module evaluation pollutes shared jsdom state and breaks unrelated animation /
// embed tests when loaded for every file. Editor test files already load it via
// the editor, so importing it up front here is free of new pollution. The safe
// remainder of the chunk (@codemirror/*, cm-focus-mode) plus the spellcheck stub
// are handled globally in src/test-setup.ts.
//
// If a NEW markdown-editor test flakes on EnvironmentTeardownError, add
// `import "@/components/__tests__/prewarm-editor-chunk";` to it.
import "@/lib/markdown/cm-inline-reveal/inline-reveal";
