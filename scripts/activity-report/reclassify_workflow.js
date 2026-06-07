// Background-agent commit reclassification for the activity report.
//
// Run with the Claude Code Workflow tool:
//   Workflow({ scriptPath: "scripts/activity-report/reclassify_workflow.js" })
//
// It runs entirely on the Claude Code subscription (background subagents), NOT
// the metered Anthropic API. Pipeline:
//   1. Prep   -- runs build_batches.py to dump commits into _batches/*.json
//   2. Classify -- one agent per batch reads subjects + changed files, labels each
//   3. (after it returns) run:
//        python3 scripts/activity-report/apply_classification.py <output.json>
//        python3 scripts/activity-report/classify_commits.py   # fill any stragglers
//        python3 scripts/activity-report/generate.py
//
// Keep LABELS in sync with the buckets in classify_commits.py / generate.py.

export const meta = {
  name: 'reclassify-commits',
  description: 'Background-agent classification of every git commit into a feature bucket',
  phases: [
    { title: 'Prep', detail: 'build_batches.py dumps commits + changed files into batches' },
    { title: 'Classify', detail: 'one agent per 100-commit batch judges the feature' },
  ],
}

const LABELS = [
  "AI helper","Admin / analytics","Auth / identity","Brand / design","Bug fix / polish",
  "Calendar / scheduling","Chore / deps / config","Cross-boundary sharing","Dark mode",
  "Demo / screenshots","ELN import (LabArchives)","Early desktop app (Kilo era)",
  "Folder / file system","Gamification / streaks","LLC / business ops","Metered storage / billing",
  "Method / kit templates","Notebooks","Notes editor","Onboarding tour","Photo annotation",
  "Real-time collab","Real-time collab (Loro/notes)","Research / spike","Search","Sequence editor",
  "Settings / UI","Tasks / experiments","Telegram integration","Transparency / OSS credits",
  "Typography system","Version control","Welcome / landing page","Wiki / docs",
]

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sha: { type: "string", description: "the 12-char sha exactly as given in the batch file" },
          label: { type: "string", enum: LABELS },
        },
        required: ["sha", "label"],
      },
    },
  },
  required: ["classifications"],
}

const GUIDE = `You are classifying git commits for the ResearchOS project. For EACH commit, decide which single feature/initiative it was primarily building toward, and return one label from the allowed set.

The strongest signal is the list of changed file paths (the "files" array) -- a commit that touches frontend/src/components/sequence-editor/* is Sequence editor work even if the subject is terse. Use the subject second. The commit date ("day") helps disambiguate (early dates pre-2026-05 are usually the Kilo-era desktop app).

Label-selection rules:
- Pick the most specific feature label that fits. Do NOT default to "Bug fix / polish" just because the subject says "fix" -- a fix to sequence-editor code is "Sequence editor", a fix to the onboarding tour is "Onboarding tour". Use the file paths to find the real home.
- "Bug fix / polish" is ONLY for genuinely cross-cutting fixes/UI polish with no single feature home.
- "Chore / deps / config" = dependency bumps, CI, build config, .gitignore, lockfiles, tooling with no feature.
- "Wiki / docs" = wiki pages, docs/, proposals, AGENTS.md, handoff reports.
- "Settings / UI" = the Settings page / generic shared UI primitives not tied to one feature.
- "Demo / screenshots" = demo-mode, fixtures, wikiCapture, screenshot tooling.
- "Real-time collab (Loro/notes)" = Loro/CRDT/unified-model notes work; "Real-time collab" = the relay/websocket/DO transport; "Version control" = notes version history.
- "Early desktop app (Kilo era)" = pre-Vercel-migration desktop/electron/onedrive/installer commits.

Return a classification for EVERY commit in the batch, using the sha exactly as given.

Allowed labels:
${LABELS.map(l => "- " + l).join("\n")}`

phase('Prep')
const prep = await agent(
  `Run this command and report ONLY the integer it prints (the number of batch files created): python3 scripts/activity-report/build_batches.py`,
  { label: 'build-batches', phase: 'Prep', schema: {
    type: "object", additionalProperties: false,
    properties: { count: { type: "integer" } }, required: ["count"],
  } }
)
const N = prep.count

phase('Classify')
const results = await parallel(Array.from({ length: N }, (_, i) => () => {
  const id = String(i).padStart(2, "0")
  return agent(
    `${GUIDE}

Read the file scripts/activity-report/_batches/batch-${id}.json (a JSON array of commits, each with sha/day/subject/files). Classify all of them and return the classifications array.`,
    { label: `batch-${id}`, phase: 'Classify', schema: SCHEMA }
  ).then(r => (r && r.classifications) ? r.classifications : [])
}))

const all = results.filter(Boolean).flat()
log(`classified ${all.length} commits across ${N} batches`)
return { classifications: all }
