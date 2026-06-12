/**
 * datahub/transform/index.ts
 *
 * Public surface of the Data Hub transform engine.
 *
 * Foundation 1 ships: executePipeline, the TransformPipeline spec, and
 * the full set of core relational TransformOp kinds.
 *
 * Foundation 1b added: derive (expr-eval), pivot, unpivot.
 *
 * Phase 2 (wrangle-2) folds the five Prism column transforms in as TransformOp
 * variants (column-transform / normalize / transpose / remove-baseline /
 * fraction-of-total), so one engine and one verb set covers both the relational
 * verbs and the column transforms.
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

export { executePipeline } from "./engine";
export type {
  TransformPipeline,
  TransformOp,
  JoinOp,
  FilterOp,
  GroupByOp,
  SelectOp,
  DropOp,
  RenameOp,
  SortOp,
  DedupeOp,
  UnionOp,
  DeriveOp,
  PivotOp,
  UnpivotOp,
  ColumnTransformOp,
  NormalizeColumnOp,
  TransposeColumnOp,
  RemoveBaselineColumnOp,
  FractionOfTotalColumnOp,
  FilterNode,
  FilterCondition,
  AggFunc,
  AggSpec,
  SortKey,
} from "./pipeline";
