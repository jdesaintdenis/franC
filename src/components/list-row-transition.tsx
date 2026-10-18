"use client";

import { useSyncExternalStore, ViewTransition } from "react";
import type { ReactElement } from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Reduce motion turns the classes to "none", so React doesn't start a view transition at all. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCE).matches,
    () => false,
  );
}

/**
 * Animates one row of a list: it fades out when it leaves, fades in when it comes back (Undo),
 * and the rows around it slide into place. The look is the `list-row` view-transition class in
 * globals.css. React only plays it for updates made inside a transition (startTransition,
 * useOptimistic, actions), so a plain setState simply changes instantly. `scope` + `id` make a
 * name that is unique on the page and a valid CSS ident (ids are UUIDs, which may start with a digit).
 */
export function ListRowTransition({
  scope,
  id,
  enter = "list-row",
  children,
}: {
  scope: string;
  id: string;
  /** "none" where new rows arrive in bulk and should not all fade. */
  enter?: "list-row" | "none";
  children: ReactElement;
}) {
  const reduced = useReducedMotion();
  return (
    <ViewTransition
      name={`${scope}-${id}`}
      default="none"
      enter={reduced ? "none" : enter}
      exit={reduced ? "none" : "list-row"}
      update={reduced ? "none" : "list-row"}
      share="none"
    >
      {children}
    </ViewTransition>
  );
}
