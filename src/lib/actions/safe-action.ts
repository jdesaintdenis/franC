import { unstable_rethrow } from "next/navigation";

import { redactError } from "@/lib/logging/redact";

export type ActionErrorState = { status: "error"; error: string };

/**
 * Runs a server action body so that unexpected failures (DB outage, driver
 * errors) become an inline error state instead of an exception that Next
 * escalates to the error boundary or a generic 500 in useActionState forms.
 *
 * `fallbackMessage` is shown to the user AND logged as the fixed context, so it
 * must be a literal: the caught error is only ever logged through `redactError`,
 * because Drizzle errors embed bound parameters (labels, amounts, dates).
 */
export async function withActionErrors<T>(
  fallbackMessage: string,
  fn: () => Promise<T>,
): Promise<T | ActionErrorState> {
  return withActionErrorState(fallbackMessage, fn, { status: "error", error: fallbackMessage });
}

/** Same as `withActionErrors` for forms whose state shape is not `{status, error}` (auth). */
export async function withActionErrorState<T, E>(
  logMessage: string,
  fn: () => Promise<T>,
  errorState: E,
): Promise<T | E> {
  try {
    return await fn();
  } catch (err) {
    // redirect()/notFound() and dynamic-rendering signals are control flow
    // implemented as throws; swallowing them would break requireUser() and sign-out.
    unstable_rethrow(err);
    console.error(logMessage, redactError(err));
    return errorState;
  }
}
