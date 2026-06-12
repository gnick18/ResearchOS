// Public surface for the nonlinear curve-fitting subsystem.

export { fitModel, type FitOptions } from "./fitter";
export {
  MODELS,
  getModel,
  listModels,
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
