/**
 * Public surface of the persona module.
 *
 * One entry point. Callers hand over concepts and an interaction type; whether
 * anything is written (anonymous users are not recorded) is decided inside.
 */
export { recordPersonaSignals } from "./record";
export type {
  ConceptInput,
  PersonaInteractionType,
  RecordPersonaSignalsArgs,
} from "./record";
