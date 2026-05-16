#!/usr/bin/env node
// Auto-grade an eval run by scoring each answer against its rubric via
// a separate Claude call (Sonnet 4.6 by default). Reads the JSONL files
// produced by run-evals.mjs, asks the grader to score each rubric point
// pass/fail, and writes a graded.jsonl + report.md alongside the inputs.
//
// Usage:
//   node grade-evals.mjs <run-dir>            # grade all model/size files in a run
//   node grade-evals.mjs <run-dir> opus-lean  # grade just one file
//
// Requires ANTHROPIC_API_KEY in the environment.

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const GRADER_MODEL = "claude-sonnet-4-6";

const GRADER_SYSTEM = `You are a strict, careful grader for an LLM eval suite.

For each answer below, you will be given the question, the model's answer, and a list of rubric points the answer SHOULD hit. Score each rubric point as PASS or FAIL based ONLY on what the answer actually says. Do not give credit for things the answer implies but does not state.

Output strict JSON only, no prose:
{
  "scores": [{"rubric_index": 0, "result": "PASS" | "FAIL", "note": "<one short sentence>"}, ...],
  "overall": "PASS" | "PARTIAL" | "FAIL"
}

Use "PASS" for overall when all rubric points are PASS. Use "FAIL" when more than half are FAIL. Use "PARTIAL" otherwise.`;

async function gradeOne(client, entry) {
  if (entry.error) {
    return {
      ...entry,
      grading: { error: entry.error, scores: [], overall: "FAIL" },
    };
  }

  const userMessage = `QUESTION: ${entry.prompt}

MODEL ANSWER:
"""
${entry.answer}
"""

RUBRIC (score each PASS or FAIL):
${entry.rubric.map((r, i) => `${i}. ${r}`).join("\n")}

Output the strict JSON only.`;

  const response = await client.messages.create({
    model: GRADER_MODEL,
    max_tokens: 1024,
    system: GRADER_SYSTEM,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlocks = response.content.filter((b) => b.type === "text");
  const raw = textBlocks.map((b) => b.text).join("\n").trim();

  let grading;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    grading = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch (err) {
    grading = { parse_error: err.message, raw, scores: [], overall: "FAIL" };
  }

  return { ...entry, grading };
}

function summarizeFile(graded) {
  const total = graded.length;
  const overall = { PASS: 0, PARTIAL: 0, FAIL: 0 };
  const byCategory = {};
  let totalRubric = 0;
  let totalRubricPass = 0;

  for (const entry of graded) {
    overall[entry.grading.overall ?? "FAIL"] = (overall[entry.grading.overall ?? "FAIL"] || 0) + 1;

    if (!byCategory[entry.category]) {
      byCategory[entry.category] = { PASS: 0, PARTIAL: 0, FAIL: 0, count: 0 };
    }
    byCategory[entry.category][entry.grading.overall ?? "FAIL"]++;
    byCategory[entry.category].count++;

    for (const score of entry.grading.scores ?? []) {
      totalRubric++;
      if (score.result === "PASS") totalRubricPass++;
    }
  }

  return {
    total,
    overall,
    rubric_pass_rate: totalRubric > 0 ? totalRubricPass / totalRubric : 0,
    by_category: byCategory,
  };
}

function renderReport(perFile) {
  const lines = [];
  lines.push("# AI Helper Eval Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Overall results by (model, size)");
  lines.push("");
  lines.push("| Model | Size | Overall PASS | PARTIAL | FAIL | Rubric pass rate |");
  lines.push("|---|---|---:|---:|---:|---:|");
  for (const f of perFile) {
    const s = f.summary;
    const rate = (s.rubric_pass_rate * 100).toFixed(1);
    lines.push(`| ${f.model} | ${f.size} | ${s.overall.PASS}/${s.total} | ${s.overall.PARTIAL ?? 0} | ${s.overall.FAIL ?? 0} | ${rate}% |`);
  }
  lines.push("");

  lines.push("## Per-category breakdown");
  lines.push("");
  for (const f of perFile) {
    lines.push(`### ${f.model} / ${f.size}`);
    lines.push("");
    lines.push("| Category | PASS | PARTIAL | FAIL |");
    lines.push("|---|---:|---:|---:|");
    for (const [cat, counts] of Object.entries(f.summary.by_category)) {
      lines.push(`| ${cat} | ${counts.PASS}/${counts.count} | ${counts.PARTIAL} | ${counts.FAIL} |`);
    }
    lines.push("");
  }

  lines.push("## Notable failures");
  lines.push("");
  for (const f of perFile) {
    const fails = f.graded.filter((e) => e.grading.overall === "FAIL" || e.grading.overall === "PARTIAL");
    if (fails.length === 0) continue;
    lines.push(`### ${f.model} / ${f.size}`);
    lines.push("");
    for (const entry of fails) {
      lines.push(`**${entry.question_id}** (${entry.grading.overall ?? "FAIL"})`);
      lines.push(`> Q: ${entry.prompt}`);
      const failedScores = (entry.grading.scores ?? []).filter((s) => s.result === "FAIL");
      for (const s of failedScores) {
        lines.push(`- FAIL: ${entry.rubric[s.rubric_index]} — _${s.note}_`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node grade-evals.mjs <run-dir> [file-prefix]");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY not set in environment.");
    process.exit(1);
  }

  const runDir = args[0];
  const filePrefix = args[1];

  const entries = await readdir(runDir);
  const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl") && !f.endsWith(".graded.jsonl"));
  const targets = filePrefix ? jsonlFiles.filter((f) => f.startsWith(filePrefix)) : jsonlFiles;

  if (targets.length === 0) {
    console.error(`No matching .jsonl files in ${runDir}`);
    process.exit(1);
  }

  console.log(`[grader] Grading ${targets.length} file(s) from ${runDir}`);
  const client = new Anthropic();
  const perFile = [];

  for (const fileName of targets) {
    const path = join(runDir, fileName);
    const text = await readFile(path, "utf8");
    const lines = text.trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => JSON.parse(l));

    const [model, size] = fileName.replace(".jsonl", "").split("-");
    console.log(`[grader] ${model} / ${size}: grading ${entries.length} answers`);

    const graded = [];
    for (const entry of entries) {
      try {
        const result = await gradeOne(client, entry);
        graded.push(result);
        process.stdout.write(result.grading.overall === "PASS" ? "." : result.grading.overall === "PARTIAL" ? "~" : "x");
      } catch (err) {
        graded.push({ ...entry, grading: { error: err.message, scores: [], overall: "FAIL" } });
        process.stdout.write("E");
      }
    }
    process.stdout.write("\n");

    const gradedPath = join(runDir, fileName.replace(".jsonl", ".graded.jsonl"));
    await writeFile(gradedPath, graded.map((g) => JSON.stringify(g)).join("\n") + "\n", "utf8");
    const summary = summarizeFile(graded);
    perFile.push({ model, size, file: fileName, graded, summary });
    console.log(`[grader]   wrote ${gradedPath} — PASS=${summary.overall.PASS}/${summary.total}, rubric ${(summary.rubric_pass_rate * 100).toFixed(1)}%`);
  }

  const report = renderReport(perFile);
  const reportPath = join(runDir, "report.md");
  await writeFile(reportPath, report, "utf8");
  console.log("");
  console.log(`[grader] Report: ${reportPath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
