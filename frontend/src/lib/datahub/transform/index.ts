/**
 * datahub/transform/index.ts
 *
 * Public surface of the Data Hub transform engine.
 *
 * Foundation 1 ships: executePipeline, the TransformPipeline spec, and
 * the full set of core TransformOp kinds.
 *
 * Foundation 1b will add: derive (expr-eval), pivot, unpivot.
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
  FilterNode,
  FilterCondition,
  AggFunc,
  AggSpec,
  SortKey,
} from "./pipeline";
