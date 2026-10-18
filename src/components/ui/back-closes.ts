"use client";

import { useEffect, useRef, useState } from "react";

/*
 * The phone's Back closes the top sheet or dialog instead of leaving the page.
 * Each open layer owns one extra history entry at the same URL: Back pops it and closes the layer.
 * Closing any other way (X, overlay, Escape, save) drops that entry again, so the next Back leaves the page.
 */

/** A history entry: its Navigation API key where the browser has one, else the history length. */
type Token = string | number;
type Layer = { close: () => void; below: Token; entry: Token };

const layers: Layer[] = [];
/** Entries we pushed that are still in the history. */
const ours = new Set<Token>();
/** Closed layers whose entry is still to be dropped (one `history.go` for all of them). */
const pending: Layer[] = [];
/** The entry (Next.js state, URL) as the last close left it: copied onto the entry our Back lands on. */
let left: { state: unknown; url: string } | null = null;
/** Our own `history.go` in flight: the entries it drops and, when known, the one it should land on. */
let travel: { dropped: Token[]; landing: Token | null } | null = null;
let skipNextPop = false;

function token(): Token {
  const navigation = (window as { navigation?: { currentEntry: { key: string } | null } }).navigation;
  return navigation?.currentEntry?.key ?? window.history.length;
}

/** Marks our own `history.go` in flight, so E2E tests wait for it before loading another page (it would cancel the load). */
function setBusy(busy: boolean) {
  document.documentElement.toggleAttribute("data-history-busy", busy);
}

function flush() {
  if (travel || pending.length === 0) return;
  setBusy(true);
  const count = pending.length;
  // Keys tell whether we landed where expected; with more than one entry the order is unknown, so skip the check.
  const landing = count === 1 && typeof pending[0].below === "string" ? pending[0].below : null;
  travel = { dropped: pending.map((layer) => layer.entry), landing };
  pending.length = 0;
  window.history.go(-count);
}

function onPopState(event: PopStateEvent) {
  if (skipNextPop) {
    skipNextPop = false;
    setBusy(false);
    event.stopImmediatePropagation();
    return;
  }
  if (travel) {
    const { dropped, landing } = travel;
    travel = null;
    for (const entry of dropped) ours.delete(entry);
    // These pops stay on the same page, so Next.js has nothing to restore.
    event.stopImmediatePropagation();
    if (landing !== null && token() !== landing) {
      // A link in the sheet navigated before our Back ran: return to the new page, leave the spare entry.
      skipNextPop = true;
      window.history.forward();
      return;
    }
    // Copy the entry we left onto this one: the close may have changed the URL (`?edit=` removed), and an older
    // Next.js state here would bring the sheet back on a later Back or Forward. Its `__NA` keeps Next.js out of it.
    if (left) window.history.replaceState(left.state, "", left.url);
    setBusy(false);
    flush();
    return;
  }
  const top = layers.pop();
  if (!top) return;
  ours.delete(top.entry);
  event.stopImmediatePropagation();
  top.close();
}

/**
 * Called from `src/instrumentation-client.ts`, before hydration: Chrome runs popstate listeners in the order they
 * were added, and ours must run before Next.js's so that it can keep Next.js from restoring a sheet's entry.
 */
export function listenForBack() {
  window.addEventListener("popstate", onPopState);
}

function claim(close: () => void): Layer {
  // Closed and (re)opened in one go, like React's dev double effects or one sheet replacing another: reuse its entry.
  const reused = travel ? undefined : pending.pop();
  let layer: Layer;
  if (reused) {
    layer = { close, below: reused.below, entry: reused.entry };
  } else {
    const below = token();
    window.history.pushState({}, "");
    layer = { close, below, entry: token() };
    ours.add(layer.entry);
  }
  layers.push(layer);
  return layer;
}

function release(layer: Layer) {
  const index = layers.indexOf(layer);
  if (index === -1) return; // closed by Back: its entry is already gone
  layers.splice(index, 1);
  // Only drop entries still on top: a link that navigated away pushed past them, and going back would undo it.
  if (!ours.has(token())) {
    ours.delete(layer.entry);
    return;
  }
  left = { state: window.history.state, url: window.location.href };
  pending.push(layer);
  queueMicrotask(flush);
}

type OpenProps = { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void };

/** Wraps a Radix Root's open props (controlled or not) so the open layer owns a history entry. */
export function useBackCloses<P extends OpenProps>(props: P): P {
  const [uncontrolled, setUncontrolled] = useState(props.defaultOpen ?? false);
  const open = props.open ?? uncontrolled;
  const onOpenChange = (next: boolean) => {
    if (props.open === undefined) setUncontrolled(next);
    props.onOpenChange?.(next);
  };
  const latest = useRef(onOpenChange);
  useEffect(() => {
    latest.current = onOpenChange;
  });
  useEffect(() => {
    if (!open) return;
    const layer = claim(() => latest.current(false));
    return () => release(layer);
  }, [open]);
  return { ...props, open, onOpenChange };
}
