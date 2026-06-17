# AI spend-test plan (controlled, reproducible)

Goal: measure real per-tier token cost for BeakerBot so we can (a) set
`AI_BARE_COST_USD_PER_TOKEN` from data and (b) write honest pricing-page copy
("about X full analyses or Y quick questions per pack").

## Setup
1. Dev server restarted with `AI_BILLING_ENABLED=true`, signed in. (done)
2. Balance topped up: `node scripts/ai-topup-local.mjs`. (done)
3. Use the **demo data folder** (Try the demo / `/demo`) so the data is the same
   every run and the test is reproducible.
4. **Start a NEW chat for each task** (one click). Each send = one task_id, and a
   fresh chat means no prior context inflates the input. This is what keeps the
   per-tier numbers clean.

## Run these in order, one per new chat

### LIGHT (quick question, usually no tools, short answer)
1. `In one sentence, what is the purpose of a qPCR melt curve?`
2. `What is the difference between a primer's Tm and its GC content?`
3. `Briefly, what does an absorbance reading at 260/280 tell you about a sample?`

### MEDIUM (a few tool calls + a synthesized answer over the demo data)
4. `List my experiments and give a one-line summary of each.`
5. `Find my methods that mention PCR and summarize each in a single line.`
6. `What's in my inventory? Group it by category and give counts.`
7. `Summarize my most recent experiment, including its key results.`

### HEAVY (many tool calls + writing an artifact)
8. `Summarize my most recent experiment, then create a new note titled "Experiment summary" containing that summary.`
9. `Look across all my experiments this month and write a note titled "Monthly progress" that pulls together what was done.`
10. `Review my methods and propose a short plan to organize them, then carry out the steps.`

## Report
```bash
cd frontend
node scripts/ai-spend-report.mjs
```
New tasks are UUID-tagged (old throwaway turns are `req_...`). Tasks 1-3 = light,
4-7 = medium, 8-10 = heavy. Paste the output and the orchestrator computes the
blended rate + per-tier cost per task.
