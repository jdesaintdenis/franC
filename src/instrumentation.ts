import { redactConsoleArgs } from "@/lib/logging/redact";

/**
 * Next prints uncaught server errors with console.error. Drizzle errors carry
 * bound query params (labels, amounts) in their message, so every console
 * error/warn in the Node runtime goes through redaction first.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  for (const method of ["error", "warn"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => original(...redactConsoleArgs(args));
  }
}
