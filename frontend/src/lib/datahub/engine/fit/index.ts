// Public surface for the nonlinear curve-fitting subsystem.

export { fitModel, type FitOptions } from "./fitter";
export {
  fitGlobal,
  type GlobalDataset,
  type GlobalFitOptions,
  type GlobalFitParameter,
  type GlobalFitResult,
} from "./global";
export {
  MODELS,
  getModel,
  listModels,
  modelExpectsLogX,
  prepareFitData,
  fivePLLogEC50Shift,
  type NonlinearModel,
} from "./models";
export {
  aicc,
  aiccCompare,
  extraSumOfSquaresF,
  type ModelFitSummary,
  type FTestComparison,
  type AiccComparison,
  type AiccModelLine,
} from "./compare";
