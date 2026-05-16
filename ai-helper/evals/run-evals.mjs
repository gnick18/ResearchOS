#!/usr/bin/env node
// Eval harness for the AI Helper system prompts.
//
// Reads the question bank in questions.json, fetches the prompt size variants
// from frontend/public/ai-helper/, and runs each question against each
// (model, size) combination via the Claude API. Captures responses to a
// timestamped JSONL file for review or self-grading via grade-evals.mjs.
//
// Uses prompt caching: the system prompt is identical across all questions
// for a given (model, size), so the first call writes the cache and subsequent
// calls read it at ~10% input cost.
//
// Usage:
//   node run-evals.mjs                            # all models, all sizes (default)
//   node run-evals.mjs --models opus,sonnet       # subset of models
//   node run-evals.mjs --sizes lean               # subset of sizes
//   node run-evals.mjs --questions feat-,schema-  # only matching question IDs
//
// Requires ANTHROPIC_API_KEY in the environment.

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const PROMPT_DIR = join(REPO_ROOT, "frontend", "public", "ai-helper");
const RESULTS_DIR = join(__dirname, "results");

const MODELS = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
};

const SIZES = ["full", "lean", "minimal"];

function parseArgs(argv) {
  const out = { models: Object.keys(MODELS), sizes: SIZES, questionFilter: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--models") out.models = argv[++i].split(",").map((m) => m.trim());
    else if (arg === "--sizes") out.sizes = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--questions") out.questionFilter = argv[++i].split(",").map((q) => q.trim());
  }
  return out;
}

async function loadPrompt(size) {
  const path = join(PROMPT_DIR, `${size}.md`);
  const content = await readFile(path, "utf8");
  return content;
}

async function loadManifest() {
  const path = join(PROMPT_DIR, "manifest.json");
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadQuestions() {
  const path = join(__dirname, "questions.json");
  return JSON.parse(await readFile(path, "utf8"));
}

function filterQuestions(questions, filter) {
  if (!filter) return questions;
  return questions.filter((q) => filter.some((prefix) => q.id.startsWith(prefix)));
}

async function runOne(client, modelId, prompt, question) {
  const start = Date.now();
  const response = await client.messages.create({
    model: modelId,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: prompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: question.prompt }],
  });
  const elapsedMs = Date.now() - start;

  const textBlocks = response.content.filter((b) => b.type === "text");
  const answer = textBlocks.map((b) => b.text).join("\n");

  return {
    question_id: question.id,
    category: question.category,
    prompt: question.prompt,
    rubric: question.rubric,
    answer,
    stop_reason: response.stop_reason,
    elapsed_ms: elapsedMs,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY not set in environment.");
    process.exit(1);
  }

  const args = parseArgs(process.argv);
  for (const m of args.models) {
    if (!MODELS[m]) {
      console.error(`ERROR: unknown model '${m}'. Valid: ${Object.keys(MODELS).join(", ")}`);
      process.exit(1);
    }
  }
  for (const s of args.sizes) {
    if (!SIZES.includes(s)) {
      console.error(`ERROR: unknown size '${s}'. Valid: ${SIZES.join(", ")}`);
      process.exit(1);
    }
  }

  await mkdir(RESULTS_DIR, { recursive: true });

  const manifest = await loadManifest();
  const questionBank = await loadQuestions();
  const questions = filterQuestions(questionBank.questions, args.questionFilter);

  console.log(`[evals] AI Helper version: ${manifest.helper_version} (built from ${manifest.built_from_commit.slice(0, 7)})`);
  console.log(`[evals] Models: ${args.models.join(", ")}`);
  console.log(`[evals] Sizes: ${args.sizes.join(", ")}`);
  console.log(`[evals] Questions: ${questions.length}`);
  console.log(`[evals] Total runs: ${args.models.length * args.sizes.length * questions.length}`);
  console.log("");

  const client = new Anthropic();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(RESULTS_DIR, `run-${timestamp}`);
  await mkdir(runDir, { recursive: true });

  const summary = {
    started_at: new Date().toISOString(),
    helper_version: manifest.helper_version,
    helper_commit: manifest.built_from_commit,
    models: args.models,
    sizes: args.sizes,
    question_count: questions.length,
    runs: [],
  };

  for (const sizeName of args.sizes) {
    const prompt = await loadPrompt(sizeName);
    const promptBytes = Buffer.byteLength(prompt, "utf8");
    console.log(`[evals] Loaded ${sizeName}.md (${promptBytes} B)`);

    for (const modelName of args.models) {
      const modelId = MODELS[modelName];
      const outFile = join(runDir, `${modelName}-${sizeName}.jsonl`);
      const lines = [];

      console.log(`[evals]   ${modelName} x ${sizeName} -> ${questions.length} calls`);

      let totalCost = { input: 0, cache_create: 0, cache_read: 0, output: 0 };
      for (const question of questions) {
        try {
          const result = await runOne(client, modelId, prompt, question);
          result.model = modelId;
          result.size = sizeName;
          lines.push(JSON.stringify(result));
          totalCost.input += result.usage.input_tokens;
          totalCost.cache_create += result.usage.cache_creation_input_tokens;
          totalCost.cache_read += result.usage.cache_read_input_tokens;
          totalCost.output += result.usage.output_tokens;
          process.stdout.write(".");
        } catch (err) {
          const errLine = JSON.stringify({
            question_id: question.id,
            model: modelId,
            size: sizeName,
            error: err.message,
            error_type: err.constructor?.name || "unknown",
          });
          lines.push(errLine);
          process.stdout.write("E");
        }
      }
      process.stdout.write("\n");

      await writeFile(outFile, lines.join("\n") + "\n", "utf8");
      console.log(`[evals]     wrote ${outFile}`);
      console.log(`[evals]     tokens: input=${totalCost.input} cache_create=${totalCost.cache_create} cache_read=${totalCost.cache_read} output=${totalCost.output}`);

      summary.runs.push({
        model: modelId,
        model_alias: modelName,
        size: sizeName,
        out_file: `${modelName}-${sizeName}.jsonl`,
        question_count: lines.length,
        tokens: totalCost,
      });
    }
  }

  summary.ended_at = new Date().toISOString();
  await writeFile(join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log("");
  console.log(`[evals] Done. Results in ${runDir}`);
  console.log(`[evals] To grade: node grade-evals.mjs ${runDir}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
