#!/usr/bin/env bash
##
## Run a /phylo published-tree reproduction case OFFLINE, then activate it.
##
## WHY THIS EXISTS
## ---------------
## The /phylo Tree Builder GENERATES a tree-building recipe, it never runs one,
## and ResearchOS has no server compute. So (exactly like gen-phylo-ggtree-golden.R
## for the layout goldens) the reproduction result is produced ONCE, offline, by a
## human in a real conda environment. This script reads a case's committed VERBATIM
## input and its builder-options.json, runs the equivalent of the Tree Builder's
## generated recipe, and rewrites that case's result.json with the resulting tree
## and pending = false. On the next build the gate (phylo-published.gate.test.ts)
## picks the case up and the /transparency section fills in. No TypeScript change
## is needed to activate a case whose published tree is already in code.
##
## This is a faithful runnable equivalent of the recipe the wizard shows
## (frontend/src/lib/phylo/recipe.ts). The canonical recipe is whatever the Builder
## emits for the same builder-options.json; if you change the recipe generator,
## re-check the flags below. Note the -T (threads) value comes from
## builder-options.json: -T AUTO is pathological on tiny alignments (IQ-TREE
## re-measures the thread count for every model), so set a small fixed -T for small
## data.
##
## HOW TO RUN
## ----------
##   frontend/scripts/run-phylo-published-case.sh <case>
## from the repository root, where <case> is a folder under
## frontend/src/lib/transparency/datasets/phylo-published/ (hpv58, turtle,
## firefly_opsin). Required tools on PATH (conda-first, the same set the wizard's
## environment.yml pins): iqtree2, and for a raw single-locus case mafft + trimal.
## python3 (standard library only) is used to read and write JSON, no jq needed.
##
## No em-dashes, no emojis, no mid-sentence colons.

set -euo pipefail

CASE="${1:-}"
if [[ -z "$CASE" ]]; then
  echo "usage: $0 <case>   (hpv58 | turtle | firefly_opsin)" >&2
  exit 2
fi

# Resolve the case directory relative to this script, so it works from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CASE_DIR="$SCRIPT_DIR/../src/lib/transparency/datasets/phylo-published/$CASE"
if [[ ! -d "$CASE_DIR" ]]; then
  echo "no such case directory: $CASE_DIR" >&2
  exit 2
fi
OPTS="$CASE_DIR/builder-options.json"
if [[ ! -f "$OPTS" ]]; then
  echo "missing $OPTS" >&2
  exit 2
fi
if [[ ! -f "$CASE_DIR/input.fasta" ]]; then
  echo "missing $CASE_DIR/input.fasta (a human must drop in the verbatim input first, see SOURCES.md)" >&2
  exit 2
fi

# Read the options we act on. Parsed with python3 (no jq dependency) into shell
# KEY=value lines we eval, so the only tools this script needs are python3 plus
# the bioinformatics binaries (iqtree2, and mafft + trimal for a raw case).
eval "$(python3 - "$OPTS" <<'PY'
import json, sys
o = json.load(open(sys.argv[1]))
def b(v): return "true" if v is True else ("false" if v is False else str(v))
keys = {
    "ANALYSIS": "analysis", "HAVE": "have", "ALIGN": "align", "TRIM": "trim",
    "MODEL": "model", "FIXED": "fixedModel", "SUPPORT": "support",
    "UFBOOT": "ufbootReps", "BSREPS": "bsReps", "BNNI": "bnni",
    "THREADS": "threads", "OUTGROUP": "outgroup", "BRLEN": "brlen",
}
for var, key in keys.items():
    val = b(o.get(key, ""))
    # Single-quote for the shell, escaping any embedded single quote.
    print(f"{var}='" + val.replace("'", "'\\''") + "'")
PY
)"

# Thread override. -T AUTO is pathological on small alignments (IQ-TREE re-measures
# the thread count for every ModelFinder model), so set PHYLO_THREADS to a small
# fixed number to skip that, e.g. PHYLO_THREADS=4 ... run-phylo-published-case.sh hpv58.
THREADS="${PHYLO_THREADS:-$THREADS}"

# Work in a per-case scratch dir so reruns are clean and the repo stays tidy.
WORK="$CASE_DIR/_run"
rm -rf "$WORK"
mkdir -p "$WORK"
cp "$CASE_DIR/input.fasta" "$WORK/input.fasta"
[[ -f "$CASE_DIR/partitions.nex" ]] && cp "$CASE_DIR/partitions.nex" "$WORK/partitions.nex"
cd "$WORK"

# IQ-TREE model string (MFP = ModelFinder Plus) and support flags, mirroring recipe.ts.
if [[ "$MODEL" == "fixed" ]]; then MODELSTR="$FIXED"; else MODELSTR="MFP"; fi
SUPPORTFLAGS=""
if [[ "$SUPPORT" == "ufboot" ]]; then
  SUPPORTFLAGS="-B $UFBOOT -alrt 1000"
  [[ "$BNNI" == "true" ]] && SUPPORTFLAGS="$SUPPORTFLAGS -bnni"
elif [[ "$SUPPORT" == "bootstrap" ]]; then
  SUPPORTFLAGS="-b $BSREPS"
fi
OUTFLAG=""
[[ -n "$OUTGROUP" && "$OUTGROUP" != "null" ]] && OUTFLAG="-o $OUTGROUP"

echo "== Case $CASE: $ANALYSIS, have=$HAVE, model=$MODELSTR, support=$SUPPORT, -T $THREADS =="

if [[ "$ANALYSIS" == "supermatrix" ]]; then
  # The committed input is the pre-concatenated supermatrix plus a partition file.
  if [[ ! -f partitions.nex ]]; then
    echo "supermatrix case needs partitions.nex next to input.fasta" >&2
    exit 2
  fi
  echo "-- partitioned ML tree (IQ-TREE) --"
  # shellcheck disable=SC2086
  iqtree2 -s input.fasta -"$BRLEN" partitions.nex -m "$MODELSTR" -T "$THREADS" --prefix ours $SUPPORTFLAGS $OUTFLAG
else
  # Single locus. Align then trim when the input is raw, else infer directly.
  ALN="input.fasta"
  if [[ "$HAVE" != "alignment" && "$ALIGN" != "skip" ]]; then
    echo "-- align ($ALIGN) --"
    case "$ALIGN" in
      mafft)    mafft --auto input.fasta > alignment.fasta ;;
      muscle)   muscle -align input.fasta -output alignment.fasta ;;
      clustalo) clustalo -i input.fasta -o alignment.fasta --outfmt=fasta --force ;;
      *) echo "unknown aligner $ALIGN" >&2; exit 2 ;;
    esac
    ALN="alignment.fasta"
  fi
  INFER_IN="$ALN"
  if [[ "$TRIM" != "skip" ]]; then
    echo "-- trim ($TRIM) --"
    case "$TRIM" in
      trimal)  trimal -in "$ALN" -out trimmed.fasta -automated1 ;;
      clipkit) clipkit "$ALN" -o trimmed.fasta -m smart-gap ;;
      *) echo "unknown trimmer $TRIM" >&2; exit 2 ;;
    esac
    INFER_IN="trimmed.fasta"
  fi
  echo "-- ML tree (IQ-TREE + ModelFinder) --"
  # shellcheck disable=SC2086
  iqtree2 -s "$INFER_IN" -m "$MODELSTR" -T "$THREADS" --prefix ours $SUPPORTFLAGS $OUTFLAG
fi

if [[ ! -f ours.treefile ]]; then
  echo "IQ-TREE did not produce ours.treefile, see the log above" >&2
  exit 1
fi

# Keep the raw result tree for provenance, then write result.json (pending = false).
cp ours.treefile "$CASE_DIR/ours.treefile"
IQ_VERSION=$(iqtree2 --version 2>/dev/null | head -1 || echo "iqtree2")

python3 - "$CASE_DIR/ours.treefile" "$CASE_DIR/result.json" "$IQ_VERSION" <<'PY'
import json, sys, datetime
treefile, resultpath, iqv = sys.argv[1], sys.argv[2], sys.argv[3]
newick = open(treefile).read().strip()
out = {
    "pending": False,
    "oursNewick": newick,
    "toolVersions": iqv.strip(),
    "ranAt": datetime.date.today().isoformat(),
    "note": "Produced offline by run-phylo-published-case.sh. The gate scores this against the published tree."
}
json.dump(out, open(resultpath, "w"), indent=2)
open(resultpath, "a").write("\n")
print("wrote", resultpath)
PY

cd "$CASE_DIR"
rm -rf "$WORK"
echo
echo "== Done. $CASE/result.json now has pending = false. =="
echo "Next: confirm the published tree is in phylo-published.ts (TURTLE/OPSIN need it added),"
echo "commit ours.treefile + result.json, optionally set the case's RF tolerance in"
echo "phylo-published.ts, then run the gate: cd frontend && npx vitest run src/lib/transparency/phylo-published.gate.test.ts"
