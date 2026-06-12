#!/usr/bin/env python3
"""
Generate INDEPENDENT ground-truth reference values for the Data Hub transform
engine (frontend/src/lib/datahub/transform/engine.ts).

WHY THIS EXISTS
---------------
The transform engine mirrors pandas behavior. Every operation's expected output
is computed HERE by pandas on a fixed, hardcoded fixture set and written to JSON.
The vitest gate (transform.gate.test.ts) loads the JSON and asserts that the JS
engine produces the EXACT same rows and columns.

A test that asserts "our engine equals what our engine produced" proves nothing.
Every reference value here comes from pandas, never from our engine.

FIXTURE TABLES (all hardcoded, small, deterministic)
----------------------------------------------------
  TABLE_A: sample experiment results (3 columns, 6 rows)
  TABLE_B: sample metadata (3 columns, 4 rows, shares "sample_id" with A)
  TABLE_C: a second batch (same schema as TABLE_A, used for union)
  TABLE_DUPES: rows with deliberate duplicates
  TABLE_TYPES: mixed numeric/string for type coercion tests

Run:
    python3 frontend/scripts/gen-datahub-transform-golden.py

Output is a JSON object written to:
    frontend/src/lib/datahub/transform/__tests__/transform-golden.json

ORDERING RULE (stated explicitly to match the engine's documented rule)
-----------------------------------------------------------------------
  - join results are ordered: left table rows first (in left-table order),
    then unmatched right rows (for right/outer joins).
  - groupby results are ordered by first occurrence of the group key.
  - sort uses pandas sort_values(kind='stable', na_position='last' for asc,
    na_position='first' for desc).
  - union results: left table rows, then right table rows.
  - filter, select, drop, rename, dedupe preserve row order.

House voice: no em-dashes, no emojis, no mid-sentence colons.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Fixture tables (hardcoded; mirrored verbatim in transform.gate.test.ts)
# ---------------------------------------------------------------------------

# TABLE_A: expression assay results per sample.
TABLE_A_ROWS = [
    {"sample_id": "S1", "strain": "WT",     "expression": 1.2},
    {"sample_id": "S2", "strain": "mutA",   "expression": 3.4},
    {"sample_id": "S3", "strain": "mutB",   "expression": 2.1},
    {"sample_id": "S4", "strain": "WT",     "expression": 1.5},
    {"sample_id": "S5", "strain": "mutA",   "expression": 4.0},
    {"sample_id": "S6", "strain": "mutB",   "expression": None},  # null value
]
TABLE_A_COLS = ["sample_id", "strain", "expression"]

# TABLE_B: sample metadata (passage, condition).
TABLE_B_ROWS = [
    {"sample_id": "S1", "passage": 3, "condition": "LB"},
    {"sample_id": "S2", "passage": 5, "condition": "M9"},
    {"sample_id": "S3", "passage": 3, "condition": "LB"},
    {"sample_id": "S7", "passage": 2, "condition": "M9"},  # no match in A
]
TABLE_B_COLS = ["sample_id", "passage", "condition"]

# TABLE_C: a second batch (same schema as A, for union).
TABLE_C_ROWS = [
    {"sample_id": "S7", "strain": "WT",   "expression": 0.9},
    {"sample_id": "S8", "strain": "mutA", "expression": 2.8},
]
TABLE_C_COLS = ["sample_id", "strain", "expression"]

# TABLE_DUPES: deliberate duplicates.
TABLE_DUPES_ROWS = [
    {"key": "A", "val": 1},
    {"key": "B", "val": 2},
    {"key": "A", "val": 3},  # duplicate key
    {"key": "C", "val": 4},
    {"key": "B", "val": 5},  # duplicate key
]
TABLE_DUPES_COLS = ["key", "val"]

# TABLE_NULL_KEYS: null values in the join key column.
TABLE_NULL_KEYS_ROWS = [
    {"id": "X1", "value": 10},
    {"id": None,  "value": 20},  # null key
    {"id": "X3", "value": 30},
]
TABLE_NULL_KEYS_COLS = ["id", "value"]

TABLE_NULL_KEYS_B_ROWS = [
    {"id": "X1", "extra": "a"},
    {"id": "X2", "extra": "b"},  # no match in A
]
TABLE_NULL_KEYS_B_COLS = ["id", "extra"]

# TABLE_MANY_MANY: many-to-many join test.
TABLE_MM_LEFT_ROWS = [
    {"k": "X", "left_val": 1},
    {"k": "X", "left_val": 2},
    {"k": "Y", "left_val": 3},
]
TABLE_MM_LEFT_COLS = ["k", "left_val"]

TABLE_MM_RIGHT_ROWS = [
    {"k": "X", "right_val": 10},
    {"k": "X", "right_val": 20},
    {"k": "Z", "right_val": 30},
]
TABLE_MM_RIGHT_COLS = ["k", "right_val"]


def make_df(rows, cols):
    """Create a pandas DataFrame from a list-of-dict fixture, preserving column order."""
    df = pd.DataFrame(rows, columns=cols)
    return df


def df_to_records(df: pd.DataFrame) -> list[dict]:
    """
    Serialize a DataFrame to a list of plain dicts for JSON output.
    NaN / NaT -> None; numpy scalars -> Python native.
    """
    records = []
    for _, row in df.iterrows():
        r = {}
        for col in df.columns:
            v = row[col]
            if v is None or (isinstance(v, float) and np.isnan(v)):
                r[col] = None
            elif isinstance(v, (np.integer,)):
                r[col] = int(v)
            elif isinstance(v, (np.floating,)):
                r[col] = float(v)
            elif isinstance(v, (np.bool_,)):
                r[col] = bool(v)
            else:
                r[col] = v
        records.append(r)
    return records


def r6(x):
    """Round to 6 decimal places, or None if null."""
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    return round(float(x), 6)


# ---------------------------------------------------------------------------
# Reference computations
# ---------------------------------------------------------------------------

def ref_join():
    """Join TABLE_A with TABLE_B on sample_id, all four how variants."""
    a = make_df(TABLE_A_ROWS, TABLE_A_COLS)
    b = make_df(TABLE_B_ROWS, TABLE_B_COLS)
    results = {}
    for how in ["inner", "left", "right", "outer"]:
        merged = pd.merge(a, b, on="sample_id", how=how, suffixes=("_x", "_y"))
        results[how] = {
            "columns": list(merged.columns),
            "rows": df_to_records(merged),
        }
    return results


def ref_join_null_keys():
    """Join with null values in the key column. pandas drops null-key rows for
    inner/left/right, and includes them as unmatched in outer."""
    a = make_df(TABLE_NULL_KEYS_ROWS, TABLE_NULL_KEYS_COLS)
    b = make_df(TABLE_NULL_KEYS_B_ROWS, TABLE_NULL_KEYS_B_COLS)
    results = {}
    for how in ["inner", "left", "outer"]:
        merged = pd.merge(a, b, on="id", how=how, suffixes=("_x", "_y"))
        results[how] = {
            "columns": list(merged.columns),
            "rows": df_to_records(merged),
        }
    return results


def ref_join_many_many():
    """Many-to-many join: 2 left rows matching key X cross with 2 right rows -> 4 result rows."""
    left = make_df(TABLE_MM_LEFT_ROWS, TABLE_MM_LEFT_COLS)
    right = make_df(TABLE_MM_RIGHT_ROWS, TABLE_MM_RIGHT_COLS)
    merged = pd.merge(left, right, on="k", how="inner", suffixes=("_x", "_y"))
    return {
        "columns": list(merged.columns),
        "rows": df_to_records(merged),
    }


def ref_filter():
    """Filter TABLE_A on various conditions."""
    a = make_df(TABLE_A_ROWS, TABLE_A_COLS)
    results = {}

    # eq: strain == "WT"
    f = a[a["strain"] == "WT"].reset_index(drop=True)
    results["strain_eq_WT"] = {"columns": list(f.columns), "rows": df_to_records(f)}

    # gt: expression > 2.0 (nulls drop naturally with pandas comparison)
    f = a[a["expression"] > 2.0].reset_index(drop=True)
    results["expression_gt_2"] = {"columns": list(f.columns), "rows": df_to_records(f)}

    # contains: strain contains "mut"
    f = a[a["strain"].str.contains("mut", na=False)].reset_index(drop=True)
    results["strain_contains_mut"] = {"columns": list(f.columns), "rows": df_to_records(f)}

    # is_empty: expression is null
    f = a[a["expression"].isna()].reset_index(drop=True)
    results["expression_is_empty"] = {"columns": list(f.columns), "rows": df_to_records(f)}

    # in: strain in ["WT", "mutA"]
    f = a[a["strain"].isin(["WT", "mutA"])].reset_index(drop=True)
    results["strain_in_WT_mutA"] = {"columns": list(f.columns), "rows": df_to_records(f)}

    # AND: strain == "mutA" AND expression > 2.0
    f = a[(a["strain"] == "mutA") & (a["expression"] > 2.0)].reset_index(drop=True)
    results["strain_mutA_and_expr_gt_2"] = {"columns": list(f.columns), "rows": df_to_records(f)}

    # NOT: not (strain == "WT")
    f = a[~(a["strain"] == "WT")].reset_index(drop=True)
    results["not_strain_WT"] = {"columns": list(f.columns), "rows": df_to_records(f)}

    return results


def ref_groupby():
    """GroupBy TABLE_A by strain, aggregate expression with all agg functions."""
    a = make_df(TABLE_A_ROWS, TABLE_A_COLS)
    results = {}

    # mean (default pandas behavior, skipna=True)
    grp = a.groupby("strain", sort=False)["expression"].mean().reset_index()
    grp.columns = ["strain", "expression_mean"]
    results["expression_mean"] = {"columns": list(grp.columns), "rows": df_to_records(grp)}

    # sum
    grp = a.groupby("strain", sort=False)["expression"].sum(min_count=0).reset_index()
    grp.columns = ["strain", "expression_sum"]
    results["expression_sum"] = {"columns": list(grp.columns), "rows": df_to_records(grp)}

    # count (non-null)
    grp = a.groupby("strain", sort=False)["expression"].count().reset_index()
    grp.columns = ["strain", "expression_count"]
    results["expression_count"] = {"columns": list(grp.columns), "rows": df_to_records(grp)}

    # min
    grp = a.groupby("strain", sort=False)["expression"].min().reset_index()
    grp.columns = ["strain", "expression_min"]
    results["expression_min"] = {"columns": list(grp.columns), "rows": df_to_records(grp)}

    # max
    grp = a.groupby("strain", sort=False)["expression"].max().reset_index()
    grp.columns = ["strain", "expression_max"]
    results["expression_max"] = {"columns": list(grp.columns), "rows": df_to_records(grp)}

    # median
    grp = a.groupby("strain", sort=False)["expression"].median().reset_index()
    grp.columns = ["strain", "expression_median"]
    results["expression_median"] = {"columns": list(grp.columns), "rows": df_to_records(grp)}

    # sd (sample, ddof=1)
    grp = a.groupby("strain", sort=False)["expression"].std(ddof=1).reset_index()
    grp.columns = ["strain", "expression_sd"]
    results["expression_sd"] = {"columns": list(grp.columns), "rows": df_to_records(grp)}

    # first non-null
    grp = a.groupby("strain", sort=False)["expression"].first().reset_index()
    grp.columns = ["strain", "expression_first"]
    results["expression_first"] = {"columns": list(grp.columns), "rows": df_to_records(grp)}

    # nunique
    grp = a.groupby("strain", sort=False)["expression"].nunique().reset_index()
    grp.columns = ["strain", "expression_nunique"]
    results["expression_nunique"] = {"columns": list(grp.columns), "rows": df_to_records(grp)}

    # concat (join string representations)
    grp = a.groupby("strain", sort=False)["expression"].apply(
        lambda s: ", ".join(str(v) for v in s if v is not None and not (isinstance(v, float) and np.isnan(v)))
    ).reset_index()
    grp.columns = ["strain", "expression_concat"]
    results["expression_concat"] = {"columns": list(grp.columns), "rows": df_to_records(grp)}

    return results


def ref_groupby_empty_group():
    """GroupBy where one group has all-null values in the aggregated column.
    The empty group should produce null for numeric aggs."""
    rows = [
        {"group": "A", "val": 1.0},
        {"group": "A", "val": 2.0},
        {"group": "B", "val": None},
        {"group": "B", "val": None},
    ]
    df = pd.DataFrame(rows)
    grp = df.groupby("group", sort=False)["val"].mean().reset_index()
    grp.columns = ["group", "val_mean"]
    return {"columns": list(grp.columns), "rows": df_to_records(grp)}


def ref_select_drop_rename():
    """Select, drop, rename ops on TABLE_A."""
    a = make_df(TABLE_A_ROWS, TABLE_A_COLS)
    results = {}

    # select: keep only sample_id and expression
    s = a[["sample_id", "expression"]].reset_index(drop=True)
    results["select_sid_expr"] = {"columns": list(s.columns), "rows": df_to_records(s)}

    # drop: remove expression
    d = a.drop(columns=["expression"]).reset_index(drop=True)
    results["drop_expression"] = {"columns": list(d.columns), "rows": df_to_records(d)}

    # rename: expression -> expr_value, strain -> genotype
    r = a.rename(columns={"expression": "expr_value", "strain": "genotype"}).reset_index(drop=True)
    results["rename_expr_strain"] = {"columns": list(r.columns), "rows": df_to_records(r)}

    return results


def ref_sort():
    """Sort TABLE_A by expression asc and desc, with null handling."""
    a = make_df(TABLE_A_ROWS, TABLE_A_COLS)
    results = {}

    # asc, nulls last (pandas default for ascending)
    s = a.sort_values("expression", ascending=True, na_position="last", kind="stable").reset_index(drop=True)
    results["expression_asc"] = {"columns": list(s.columns), "rows": df_to_records(s)}

    # desc, nulls first (pandas default for descending)
    s = a.sort_values("expression", ascending=False, na_position="first", kind="stable").reset_index(drop=True)
    results["expression_desc"] = {"columns": list(s.columns), "rows": df_to_records(s)}

    # multi-key: strain asc, expression desc
    s = a.sort_values(
        ["strain", "expression"],
        ascending=[True, False],
        na_position="last",
        kind="stable",
    ).reset_index(drop=True)
    results["strain_asc_expr_desc"] = {"columns": list(s.columns), "rows": df_to_records(s)}

    return results


def ref_dedupe():
    """Dedupe TABLE_DUPES with various subset/keep options."""
    d = make_df(TABLE_DUPES_ROWS, TABLE_DUPES_COLS)
    results = {}

    # All columns, keep first
    r = d.drop_duplicates(keep="first").reset_index(drop=True)
    results["all_first"] = {"columns": list(r.columns), "rows": df_to_records(r)}

    # All columns, keep last
    r = d.drop_duplicates(keep="last").reset_index(drop=True)
    results["all_last"] = {"columns": list(r.columns), "rows": df_to_records(r)}

    # Subset=["key"], keep first
    r = d.drop_duplicates(subset=["key"], keep="first").reset_index(drop=True)
    results["key_subset_first"] = {"columns": list(r.columns), "rows": df_to_records(r)}

    # Subset=["key"], keep last
    r = d.drop_duplicates(subset=["key"], keep="last").reset_index(drop=True)
    results["key_subset_last"] = {"columns": list(r.columns), "rows": df_to_records(r)}

    return results


def ref_union():
    """Union TABLE_A with TABLE_C (same columns). Also test column alignment."""
    a = make_df(TABLE_A_ROWS, TABLE_A_COLS)
    c = make_df(TABLE_C_ROWS, TABLE_C_COLS)
    results = {}

    # Same-schema union
    u = pd.concat([a, c], ignore_index=True)
    results["same_schema"] = {"columns": list(u.columns), "rows": df_to_records(u)}

    # Column alignment: TABLE_A and a table with a different (extra) column
    extra_rows = [
        {"sample_id": "SX", "batch": "B2"},
    ]
    extra = pd.DataFrame(extra_rows)
    u2 = pd.concat([a, extra], ignore_index=True)
    results["extra_column"] = {"columns": list(u2.columns), "rows": df_to_records(u2)}

    return results


def ref_chains():
    """Representative chained pipelines: join -> filter -> groupby."""
    a = make_df(TABLE_A_ROWS, TABLE_A_COLS)
    b = make_df(TABLE_B_ROWS, TABLE_B_COLS)

    # Chain 1: inner join A+B, filter expression > 1.0, groupby strain mean expression
    merged = pd.merge(a, b, on="sample_id", how="inner", suffixes=("_x", "_y"))
    filtered = merged[merged["expression"] > 1.0].reset_index(drop=True)
    grouped = filtered.groupby("strain", sort=False)["expression"].mean().reset_index()
    grouped.columns = ["strain", "expression_mean"]
    chain1 = {"columns": list(grouped.columns), "rows": df_to_records(grouped)}

    # Chain 2: left join A+B, select columns, sort by expression asc
    merged2 = pd.merge(a, b, on="sample_id", how="left", suffixes=("_x", "_y"))
    selected = merged2[["sample_id", "strain", "expression", "condition"]].copy()
    sorted2 = selected.sort_values("expression", ascending=True, na_position="last", kind="stable").reset_index(drop=True)
    chain2 = {"columns": list(sorted2.columns), "rows": df_to_records(sorted2)}

    # Chain 3: filter, rename, dedupe
    filtered3 = a[a["strain"].isin(["WT", "mutA"])].reset_index(drop=True)
    renamed3 = filtered3.rename(columns={"strain": "genotype"})
    deduped3 = renamed3.drop_duplicates(subset=["genotype"], keep="first").reset_index(drop=True)
    chain3 = {"columns": list(deduped3.columns), "rows": df_to_records(deduped3)}

    return {
        "join_filter_groupby": chain1,
        "left_join_select_sort": chain2,
        "filter_rename_dedupe": chain3,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    bundle = {
        "provenance": {
            "pandas": pd.__version__,
            "numpy": np.__version__,
            "python": sys.version,
            "description": (
                "Reference values for the Data Hub transform engine, "
                "computed by pandas. Every operation matches the engine's "
                "documented ordering and type-coercion rules."
            ),
        },
        "fixtures": {
            "TABLE_A": {"columns": TABLE_A_COLS, "rows": TABLE_A_ROWS},
            "TABLE_B": {"columns": TABLE_B_COLS, "rows": TABLE_B_ROWS},
            "TABLE_C": {"columns": TABLE_C_COLS, "rows": TABLE_C_ROWS},
            "TABLE_DUPES": {"columns": TABLE_DUPES_COLS, "rows": TABLE_DUPES_ROWS},
            "TABLE_NULL_KEYS": {"columns": TABLE_NULL_KEYS_COLS, "rows": TABLE_NULL_KEYS_ROWS},
            "TABLE_NULL_KEYS_B": {"columns": TABLE_NULL_KEYS_B_COLS, "rows": TABLE_NULL_KEYS_B_ROWS},
            "TABLE_MM_LEFT": {"columns": TABLE_MM_LEFT_COLS, "rows": TABLE_MM_LEFT_ROWS},
            "TABLE_MM_RIGHT": {"columns": TABLE_MM_RIGHT_COLS, "rows": TABLE_MM_RIGHT_ROWS},
        },
        "references": {
            "join": ref_join(),
            "join_null_keys": ref_join_null_keys(),
            "join_many_many": ref_join_many_many(),
            "filter": ref_filter(),
            "groupby": ref_groupby(),
            "groupby_empty_group": ref_groupby_empty_group(),
            "select_drop_rename": ref_select_drop_rename(),
            "sort": ref_sort(),
            "dedupe": ref_dedupe(),
            "union": ref_union(),
            "chains": ref_chains(),
        },
    }

    out_path = Path(__file__).parent.parent / "src" / "lib" / "datahub" / "transform" / "__tests__" / "transform-golden.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(bundle, f, indent=2, default=str)
    print(f"Written: {out_path}")
    print(f"pandas {pd.__version__} | numpy {np.__version__}")


if __name__ == "__main__":
    main()
