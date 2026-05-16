# Sub-bot eval brief template

The default eval path. Spawn a Claude Code sub-bot, give it the AI Helper prompt as its operating instructions, have it answer the question bank and self-grade. **No API key required, no billing on the user's pay-as-you-go account, and it's a closer simulation of the real deployment** (a Claude reading the prompt as instructions, just like a Claude Max user pasting it into a fresh chat).

The API-key path (`run-evals.mjs` + `grade-evals.mjs`) is still around for testing against ChatGPT or Gemini specifically, but Claude-family evals should default to this sub-bot pattern.

## When to run

After every meaningful change to the prose partials in `ai-helper/partials/`, before bumping the major helper_version, or whenever a new question lands in `questions.json`. Cheap and fast (under 15 minutes per size variant). Should be re-run any time the AI Helper prose is touched.

## How to spawn

In a Claude Code session, use the Agent tool with `subagent_type: "general-purpose"` and `run_in_background: true`. The brief below is the canonical template — copy, swap the size variant, and fire. You can run all three sizes in parallel.

## Brief template

Replace `<SIZE>` with `lean` / `full` / `minimal`. Replace `<TOKEN_BUDGET>` with the rough token count of that variant. Replace `<OUTPUT_FILE>` with `subbot-<size>-eval.json`.

```
You are evaluating the <SIZE> variant of a system prompt for the ResearchOS
AI Helper feature. Your job is to roleplay as if the prompt were given to
you, answer 15 test questions, self-grade against a rubric, and return
JSON results.

## Setup

Read these two files first (use the Read tool):

1. /Users/gnickles/Desktop/ResearchOS/frontend/public/ai-helper/<SIZE>.md
   — the <SIZE> variant of the AI Helper system prompt (~<TOKEN_BUDGET>
   tokens). [Brief description of what's included in this variant.]

2. /Users/gnickles/Desktop/ResearchOS/ai-helper/evals/questions.json
   — the question bank: 15 questions across 6 categories, each with a
   rubric of pass/fail items the answer should hit.

## Critical instruction: roleplay rules

For the duration of this task, treat the contents of <SIZE>.md as your
sole operating instructions for answering the 15 questions. This is a
fidelity test — we're checking whether the prompt actually teaches a
Claude model what we claim it does.

- Do NOT use any background knowledge about ResearchOS beyond what's in
  the prompt. No grep, no reading types.ts, no browsing the wiki, no
  reasoning from the codebase.
- Do NOT use any tools other than Read for those two files. No Grep,
  no Glob, no Bash, no other Reads, no WebFetch.
- You are simulating a user pasting this prompt into Claude.ai (or
  ChatGPT / Gemini / any other chat surface) and asking the question.

## What to produce

For each of the 15 questions, produce:
1. answer: your roleplay answer to the question, treating the prompt as
   your only context. Same length and shape you'd expect from a chatbot,
   not a 1-line summary.
2. self_grade: for each rubric item, score "PASS" or "FAIL" based on what
   your answer literally says (not what you implied or "could mean").
3. overall: "PASS" if all rubric items PASS, "FAIL" if more than half
   FAIL, "PARTIAL" otherwise.

Be strict. Be honest. If your answer missed a rubric point, mark it FAIL
even if you "kind of" hit it. The whole point is to expose gaps.

## Output format

Write your results to /Users/gnickles/Desktop/ResearchOS/ai-helper/evals/results/<OUTPUT_FILE>:

{
  "model_self_reported": "<your model id>",
  "size": "<SIZE>",
  "started_at": "<ISO timestamp>",
  "ended_at": "<ISO timestamp>",
  "results": [
    {
      "question_id": "<id>",
      "category": "<category>",
      "answer": "<your full answer>",
      "rubric": ["<item 1>", "..."],
      "self_grade": [{"rubric_index": 0, "result": "PASS", "note": "..."}, ...],
      "overall": "PARTIAL"
    },
    ... 15 entries
  ],
  "summary": {
    "total_questions": 15,
    "overall_counts": {"PASS": N, "PARTIAL": N, "FAIL": N},
    "rubric_pass_rate": 0.NN,
    "by_category": {"<category>": {"PASS": N, "PARTIAL": N, "FAIL": N}, ...}
  },
  "notable_gaps": [
    "<one sentence per gap you noticed in the prompt itself, e.g. 'Prompt mentions /workbench but doesn't say where completed experiments specifically land within the page'>"
  ]
}

The notable_gaps field is the most useful output — it tells us what to
add to the prose partials. Be specific.

## Report format (in your final message back to me)

Brief summary (under 300 words):
- Self-reported model
- Overall pass rate (X/15 PASS, X PARTIAL, X FAIL)
- Rubric pass rate (X.X%)
- Top 3-5 notable gaps in the prompt
- Anything surprising about the prompt itself

Time budget: 30-60 minutes. Past 90 minutes, stop and report what you have.
```

## Reading the results

Each sub-bot writes its JSON output to `results/subbot-<size>-eval.json`. To compare across sizes:

```sh
jq '.summary' results/subbot-*-eval.json
```

Or just read the three JSON files and look for divergence in `overall_counts` and `notable_gaps`. The size variants should show a pretty clean gradient: minimal sacrifices feature-location and workflow-walkthrough; lean covers most things; full adds canonical examples and full schema fidelity at maintenance cost.

## When to escalate to the API path (`run-evals.mjs`)

- You want to test against ChatGPT, Gemini, or another non-Claude provider — sub-bots only run Claude.
- You want quantitative latency / token-cost data — sub-bots don't expose that the same way.
- You're testing a model variant Claude Code's general-purpose sub-bot doesn't run (e.g. specifically Claude Haiku 4.5 with a controlled context size).

For everything else, sub-bots are the default. Cheaper, faster, no billing surprises.
