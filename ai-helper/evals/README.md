# AI Helper eval harness

A small standalone harness for testing the ResearchOS AI Helper system prompts against real Claude API calls. Use this to verify the prompt actually does what we claim — and to catch regressions when prose partials change.

## What it does

1. Loads the question bank at [questions.json](questions.json) (15 questions across 6 categories: feature-location, schema-recall, workflow-walkthrough, drafting, behavior-guardrails, limitation-honesty).
2. Loads the size-variant prompts from `frontend/public/ai-helper/{full,lean,minimal}.md`.
3. Runs each question against each (model, size) combination via the Claude API, with prompt caching so the system prompt only writes once per combo.
4. Captures responses to timestamped JSONL files under `results/`.
5. Optional: auto-grades each answer against its rubric using a separate Claude call (Sonnet 4.6 as judge) and emits a markdown report.

## Setup

```sh
cd ai-helper/evals
npm install
export ANTHROPIC_API_KEY="sk-ant-..."
```

Get an API key at <https://console.anthropic.com>.

## Usage

```sh
# Default: all 3 models (Opus 4.7, Sonnet 4.6, Haiku 4.5) x all 3 sizes (full/lean/minimal)
node run-evals.mjs

# Subset filters
node run-evals.mjs --models opus,sonnet
node run-evals.mjs --sizes lean
node run-evals.mjs --questions feat-,schema-

# Most useful first run: lean prompt against all 3 models
node run-evals.mjs --sizes lean
```

Results land in `results/run-<timestamp>/` as one JSONL file per (model, size) pair, plus a `summary.json` with token + cost data.

## Auto-grading

```sh
# Grade an entire run
node grade-evals.mjs results/run-2026-05-15T20-00-00-000Z

# Grade a single (model, size)
node grade-evals.mjs results/run-2026-05-15T20-00-00-000Z opus-lean
```

Produces `<file>.graded.jsonl` per input file plus `report.md` with overall pass rates, per-category breakdown, and a list of notable failures.

## Cost estimates (with prompt caching)

Per (model, size) combo for the 15-question bank:

| Model | Lean (~16k tokens) | Full (~26k) | Minimal (~4k) |
|---|---|---|---|
| Opus 4.7 | ~$0.15 | ~$0.30 | ~$0.05 |
| Sonnet 4.6 | ~$0.10 | ~$0.18 | ~$0.03 |
| Haiku 4.5 | ~$0.04 | ~$0.06 | ~$0.01 |

Full sweep (3 models x 3 sizes x 15 questions = 135 calls): ~$8-10. Single (lean only, all models): ~$0.30.

Auto-grading adds ~15 calls per (model, size) at Sonnet rates with no caching, so ~$0.10 per file graded.

## When to run

The maintenance contract for the AI Helper feature (per [AI_HELPER_PROPOSAL.md](../../AI_HELPER_PROPOSAL.md)) calls for a re-eval whenever:

- The prose partials in `ai-helper/partials/` are edited (chip 2 territory)
- A new entity / method type lands in `frontend/src/lib/types.ts` (the schema section auto-extracts; this verifies the prompt actually still teaches it)
- A new feature ships that should affect a feature-location question (add a new question in `questions.json` first, then re-run)
- Before bumping the major prompt version

Results are gitignored — they accumulate fast. Commit a snapshot manually if a particular run is worth preserving (e.g. baseline scores at v1 launch).

## Question bank format

Each question has:

```json
{
  "id": "feat-share-task",
  "category": "feature-location",
  "prompt": "How do I share a task with my labmate so they can edit it too?",
  "rubric": [
    "Mentions the Share popup or Share button on the task",
    "Distinguishes view vs edit permission",
    "Notes that the recipient sees it via _shared_with_me.json overlay (or equivalent: shared into their account)",
    "Mentions that edit permission lets them write to your task (owner-routed)"
  ]
}
```

The rubric is a list of independently-gradeable claims the answer SHOULD include. The grader scores each PASS / FAIL and rolls up to PASS (all rubric points met) / PARTIAL / FAIL (more than half missed).

## Adding new questions

Edit `questions.json`. Keep rubric items concrete and independently testable — vague criteria ("answer is helpful") produce noisy results. The categories are open-ended; add new ones if you have a coherent group.

Good questions to add over time:

- New feature locations as features ship
- Schema recall for new entity types
- Drafting templates for new method protocols
- Guardrail tests for any newly-discovered failure modes (the prompt might leak a thing it shouldn't, or invent a field it shouldn't)
- Limitation tests for new "no, ResearchOS doesn't do that" surfaces
