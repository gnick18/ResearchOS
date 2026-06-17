# Handoff — LiveMarkdownEditor + experiment/note popup redesign (2026-06-14)

Live session (Chrome-verified). Everything below is on **LOCAL main, unpushed**. The whole arc was about making the experiment/note popup + editor into one calm "writing room" matching the approved mockups (`docs/mockups/2026-06-13-{focus-mode-redesign,everyday-editor-redesign,unified-focus-surface}.html`). Design doc: `plans/UNIFIED_EDITOR_SURFACE_DESIGN.md`. Memory: `project_focus_mode_unification`.

## ONE THING IN FLIGHT — ✅ LANDED 2026-06-14 (merge `4a40e4a1c`)
**Variation Notes → right column + hover summary** — DONE on local main, **NOT browser-verified yet** (Grant testing live on :3000). The background agent `a110d5c2358bbfaa4` rewrote the panel but left it uncommitted + unwired; the takeover agent finished the wiring, committed (`4726609ee`), and merged atomically. Done relay sent to the Mobile UI lane (`local_e2fcaa81-…`).
- Panel rewritten from the full-width collapsible top band → calm right-edge column: compact date/title cards w/ one-line preview; hover a card → floating full-text popup (modeled on `MethodExperimentsSidebar.tsx:241-260`, `fixed w-80 bg-surface-raised shadow-xl pointer-events-none`); collapse chevron folds to a thin vertical "Variations (N)" strip; neutral tokens; add/edit/delete + read-only gating preserved.
- **Architecture:** hoisted the panel OUT of all 10 per-type `*MethodTabContent` viewers into a single shared mount in `MethodTabs.tsx` (reads `activeAttachment.variation_notes`); viewers now receive `hideVariationNotes` so only the hoisted column renders. It's a 4th full-height root region: **rail | content | variations**. MobileUI's 3-region rail/toolbar + per-type left-rail accents untouched.
- **LIVE-VERIFY CHECKLIST (Grant):** Method tab on an experiment → right-edge "Variations" column of compact cards; hover a card → full-note popup opens to the LEFT; collapse chevron → thin vertical "Variations (N)" strip → expand restores; Add / Edit all / per-card delete all work; read-only task (shared/PI) hides Add+delete. Light + dark. Switching method components updates the column to that component's notes.

## DONE + browser-verified on main (the redesign, in order)
- **L1 calm atom**: `.ros-editor-room` warm-paper surface + writing-room type + quiet ＋-overflow toolbar; slim gutter **insert rail** + `/`-insert + paperclip Attachments glyph.
- **Dark room** (dark-mode editor surface) — Grant chose dark room over warm paper.
- **Unify U1–U6**: focus = the popup grows in place (sealed focus overlay/portal/buffer RETIRED), pinned navigable tabs, dozing chrome.
- **U5 toggles**: typewriter scroll + focus dimming (per-user, default off, in the ⊙ "Writing focus" menu).
- **One Focus control** (`dfaa2bcf9`): merged the duplicate editor-toolbar "Focus" button + header "Fullscreen" toggle into ONE — the header ⤢ labeled "Focus"/"Exit focus" (no more "Fullscreen"); Cmd/Ctrl+Shift+F still toggles.
- **Edge-to-edge fill** (`e202f72cf`): the expanded wrapper had capped the whole room to `measureClass` (~640px centered card in white + killed the rail gutters). Dropped it → room fills (roomW 1984), text centered by the INNER measure, rails appear.
- **Centered floating pill** (`28de3144f`) + **slim pill** (`ac70764b1`): at fullscreen the toolbar is a centered translucent pill (Edit/Preview · ＋ · 📎 · ⊙); width presets moved into the ⊙ menu, Save-checkpoint into the ⋯ overflow, duplicate "Saved" removed, EXPERIMENT chip + left shortcuts chevron hidden.
- **Whole popup = ONE continuous calm surface** (`4109c2d4d`): the headline fix Grant kept flagging — the popup SHELL (header: title/subline/tabs) was a white band on top of the warm body. New **`.ros-calm-surface`** (globals.css): at fullscreen the popup CONTAINER owns the warm-paper(light)/dark-room(dark) surface for the WHOLE popup, the inner `.ros-editor-room` goes transparent, header dividers drop. Both popups, docked unchanged (gated on `isExpanded`).
- **Dark room = EXACT mockup tokens** (`fb7b5dda0`): room-top `#10182a`, room-bot `#0a1120`, paper `#e7eefb`, muted `#9fb0c8`, accent `#39a7e6`, raised `#16233c` (not my earlier approximations).
- **Dark-room edit text readability** (`db6355a3a`): the CM host `.cm-inline-editor` carries its OWN `.light-scope` (closer ancestor of `.cm-content` than `.ros-editor-room`), forcing dark text on the dark room. Fix = re-assert the dark CM palette at `[data-theme=dark] .ros-editor-room .cm-inline-editor` (2 classes beats light-scope's 1).
- **Method tab de-yellowed** (`7b8408d9c`): Variation Notes panel + warm surfaces → neutral tokens; KEPT semantic amber (modified-cell deviation cue, "Unsaved changes", genuine warning/confirm callouts). Did NOT touch the method-nav left rail.
- **Details tab unified** (`eb1f99329`): the boxed "Properties" card dissolves into the calm surface at fullscreen (`.ros-calm-surface .ros-detail-card { transparent }`), reads as one editorial canvas like the rest.

Also (non-editor, this session): splash tip-pour single-pour + rainbow fade + Split Stage wired as the real launch splash; relayed BeakerBot smoke-test report to BeakerAI; loro-test mock fix `9255003d0`.

## Live-browser verification playbook (hard-won this session)
- Grant runs main on **:3000**. Verify there via Claude-in-Chrome — but navigate to **`http://127.0.0.1:3000`**, NOT localhost (localhost gets HSTS-upgraded to https which fails the cert). Enter **`/demo`** for populated experiments without a connected folder.
- **`globals.css` edits trigger a full Next reload** that drops the demo session + dark-mode toggle + closes any open popup — re-navigate `/demo` and re-toggle dark after. (.tsx edits HMR in place, popup stays open.)
- The **dozing chrome can't be woken by a synthetic hover** (real mouse only — Grant confirmed). To inspect the toolbar/rails when dozed, JS-force `el.style.opacity='1'`, or read computed state via `javascript_tool` (immune to the doze). The doze is NOT a bug.
- Toggle dark via the **avatar menu → Dark mode** (JS `setAttribute('data-theme','dark')` gets reverted by the theme provider).
- **Merge from worktrees with a SINGLE atomic `git merge --no-ff <branch> -m "..."`** — the shared main checkout has a concurrent-lane index race; a `--no-commit` + separate `git commit` got my staged merge swept into a neighbor's commit once. Check overlap first: `comm -12 <(git diff --name-only $MB..main|sort) <(git diff --name-only $MB..$BR|sort)`.

## Open / pending
- **Experiment continuous-autosave** — still Grant's call (experiments are manual-save; the L3 ambient indicator is honest about it). Not built.
- **"Maximum update depth exceeded"** render-loop — BeakerBot smoke test showed it on every write op; another lane fixed a methods deep-link storm (`8cae4348d`) but the BeakerBot-write loop may persist. Also: rename a method updates frontmatter title but NOT the in-body H1 (flagged to BeakerAI).
- Cross-lane: BeakerAI got the editor prop-change heads-up (sent); MobileUI owes a "done" once var-notes lands (above).
- Nothing pushed to origin all session.

## Key files
`frontend/src/components/LiveMarkdownEditor.tsx` (editor atom + pill + rails + focus), `InlineMarkdownEditor.tsx` (CM6 host), `TaskDetailPopup.tsx` + `NoteDetailPopup.tsx` (popup shells + `.ros-calm-surface` containers + headers), `frontend/src/app/globals.css` (`.ros-editor-room` / `.ros-calm-surface` / dark-room / focus-dimming rules), `methods/VariationNotesPanel.tsx` + per-type `*MethodTabContent.tsx`, `MethodTabs.tsx` (MobileUI's 3-region — don't revert).
