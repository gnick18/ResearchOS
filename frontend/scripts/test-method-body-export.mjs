// Verification probe: load alex's method 1 demo JSON, run it through the
// `normalizeMethodRecord` lazy-promote helper, and confirm `source_path`
// resolves to the .md body — and that the .md body itself is non-empty.
//
// Background: the Tier 3 PDF audit (2026-05-14) found alex's task-2 PDF
// export rendered the method section as "(No method body available.)"
// despite the .md file existing on disk. Mechanism: the demo seed's
// `methodJson()` wrote `source_path: null` and stashed the body path
// under `attachments[0].path`, which the Method type doesn't recognize.
// The export pipeline reads `method.source_path` directly, found null,
// and fell through to the fallback string.
//
// Fix: `normalizeMethodRecord` now promotes a markdown-typed
// attachments[0].path into source_path lazily. The seed generator was
// also corrected to write the canonical shape. This probe verifies
// both code paths produce a readable body.
//
// Pass = source_path is the canonical .md path AND the .md content
// contains the expected protocol body. Fail = bug to file.

import { readFileSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FRONTEND_DIR = resolvePath(__dirname, "..");

const METHOD_JSON_PATH = resolvePath(
  FRONTEND_DIR,
  "public/demo-data/users/alex/methods/1.json",
);
const METHOD_MD_PATH = resolvePath(
  FRONTEND_DIR,
  "public/demo-data/users/alex/methods/1.md",
);

// Inline mirror of normalizeMethodRecord (src/lib/local-api.ts). Kept here
// so this probe doesn't drag in the `@/` path-alias resolver.
function normalizeMethodRecord(raw) {
  if (raw.source_path == null && typeof raw.github_path === "string") {
    return { ...raw, source_path: raw.github_path };
  }
  if (raw.source_path == null && Array.isArray(raw.attachments)) {
    const mdAttachment = raw.attachments.find(
      (a) => a && a.attachment_type === "markdown" && typeof a.path === "string"
    );
    if (mdAttachment && mdAttachment.path) {
      return { ...raw, source_path: mdAttachment.path };
    }
  }
  return raw;
}

const failures = [];
function expect(cond, msg) {
  if (!cond) failures.push(msg);
}

// ── Case 1: regenerated demo seed (canonical shape) ─────────────────────────
const fresh = JSON.parse(readFileSync(METHOD_JSON_PATH, "utf8"));
const normFresh = normalizeMethodRecord(fresh);
expect(
  normFresh.source_path === "users/alex/methods/1.md",
  `[fresh seed] source_path expected "users/alex/methods/1.md", got ${JSON.stringify(normFresh.source_path)}`,
);

// ── Case 2: legacy shape (source_path:null + attachments[0].path) ───────────
const legacy = {
  id: 1,
  name: "[Demo protocol] Yeast transformation (LiAc)",
  source_path: null,
  method_type: "markdown",
  folder_path: "Strains",
  parent_method_id: null,
  tags: ["demo"],
  attachments: [
    {
      id: "att-1",
      name: "Protocol",
      attachment_type: "markdown",
      path: "users/alex/methods/1.md",
      order: 0,
    },
  ],
  is_public: false,
  created_by: "alex",
  owner: "alex",
  shared_with: [],
};
const normLegacy = normalizeMethodRecord(legacy);
expect(
  normLegacy.source_path === "users/alex/methods/1.md",
  `[legacy shape] source_path expected "users/alex/methods/1.md" (promoted from attachments[0].path), got ${JSON.stringify(normLegacy.source_path)}`,
);

// ── Case 3: the body file resolves and is non-empty ─────────────────────────
const body = readFileSync(METHOD_MD_PATH, "utf8");
expect(body.length > 100, `[body file] expected >100 chars, got ${body.length}`);
expect(
  body.includes("Yeast transformation (LiAc)"),
  `[body file] expected to contain "Yeast transformation (LiAc)"`,
);
expect(
  body.includes("PEG-3350"),
  `[body file] expected to contain "PEG-3350" (reagent list)`,
);
expect(
  body.includes("heat-shock 42 °C"),
  `[body file] expected to contain "heat-shock 42 °C" (step 6)`,
);

if (failures.length) {
  console.error("FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log("PASS — method body resolves through both fresh seed and legacy lazy-normalize, body content intact");
}
