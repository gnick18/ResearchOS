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
  xLooksLogDose,
  fitLog10sDose,
  prepareFitData,
  fivePLLogEC50Shift,
  type DoseXScale,
  type PreparedFitData,
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
