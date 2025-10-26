/**
 * Stub module used to satisfy optional `canvas` imports in browser builds.
 * The actual pdf.js integration runs entirely client-side, so the real
 * node-canvas implementation is unnecessary here.
 */

const noop = {};

export default noop;

