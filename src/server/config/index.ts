/**
 * Public surface of the config module.
 *
 * Timeouts and base URLs live here so they are not scattered as literals across
 * call sites. Both accessors check an explicitly named environment variable
 * first — there is no automatic `{SERVICE}_TIMEOUT_MS` convention, so adding a
 * knob means naming it here.
 */
export { getTimeout, getUrl, DEFAULT_TIMEOUTS, DEFAULT_URLS } from "./defaults";
