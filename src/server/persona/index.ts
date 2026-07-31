/**
 * Public surface of the persona module.
 *
 * `recordPersonaSignals` is the flows' entry point: global concept graph
 * + typed mastery-ledger signal + interaction log (anonymous users get
 * the graph only). `recordExposureSignal` is the render-gated ledger
 * write used when contract content actually reaches the reader.
 */
export {
  recordPersonaSignals,
  recordExposureSignal,
  recordConceptGraph,
  MAX_CONCEPTS_PER_INTERACTION,
  MAX_CONCEPT_NAME_LENGTH,
  MAX_CONCEPT_DESCRIPTION_LENGTH,
  MAX_CONCEPT_DOMAIN_LENGTH,
} from "./record";
export type {
  ConceptInput,
  PersonaInteractionType,
  RecordExposureSignalArgs,
  RecordPersonaSignalsArgs,
} from "./record";
