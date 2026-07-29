/**
 * Public surface of the auth module.
 *
 * Route handlers call `requireAuthenticatedUserId()` and catch
 * `AuthenticationRequiredError`. There is no middleware — protection is
 * per-handler, so this surface is deliberately the whole of it.
 */
export {
  AUTH_REQUIRED_MESSAGE,
  AuthenticationRequiredError,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "./user";
