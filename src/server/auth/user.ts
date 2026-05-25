import { auth } from "@clerk/nextjs/server";

export const AUTH_REQUIRED_MESSAGE = "Sign in to use personalized reading features.";

export class AuthenticationRequiredError extends Error {
  constructor(message = AUTH_REQUIRED_MESSAGE) {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export async function requireAuthenticatedUserId(): Promise<string> {
  const { userId } = await auth();
  const resolvedUserId = userId?.trim();

  if (!resolvedUserId) {
    throw new AuthenticationRequiredError();
  }

  return resolvedUserId;
}

export function isAuthenticationRequiredError(
  error: unknown,
): error is AuthenticationRequiredError {
  return error instanceof AuthenticationRequiredError;
}
