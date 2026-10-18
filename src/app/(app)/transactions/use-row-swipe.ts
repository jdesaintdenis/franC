"use client";

import { useRef, useState, type MouseEvent, type PointerEvent } from "react";

import { swipeAxis } from "@/lib/review/swipe";
import { BOTH_DIRECTIONS, clampRowOffset, rowSwipeOutcome, type RowSwipeOutcome, type SwipeDirections } from "@/lib/transactions/row-swipe";

interface Options {
  /** Called with where a finished drag led; never null. */
  onOutcome: (outcome: Exclude<RowSwipeOutcome, null>) => void;
  disabled?: boolean;
  /** Sides that do something; a drag towards the other one doesn't move the row. */
  directions?: SwipeDirections;
}

interface Gesture {
  x: number;
  y: number;
  width: number;
  locked: boolean;
}

// The "more actions" button keeps its own behaviour: a drag that starts on it is never a swipe.
const NO_SWIPE = "[data-no-swipe]";

/**
 * Horizontal swipe on a row, for touch and pen input only (a mouse never swipes). The element
 * needs `touch-action: pan-y` so the browser keeps vertical scrolling. Modelled on the review
 * screen's `useSwipe`, but two-way (right = category, left = more) and clamped.
 */
export function useRowSwipe({ onOutcome, disabled = false, directions = BOTH_DIRECTIONS }: Options) {
  const gesture = useRef<Gesture | null>(null);
  const swiped = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  function reset() {
    gesture.current = null;
    setDragging(false);
    setOffset(0);
  }

  return {
    offset,
    dragging,
    handlers: {
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (disabled || (!directions.right && !directions.left) || e.pointerType === "mouse" || !e.isPrimary) return;
        if ((e.target as Element).closest(NO_SWIPE)) return;
        gesture.current = { x: e.clientX, y: e.clientY, width: e.currentTarget.getBoundingClientRect().width, locked: false };
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        const g = gesture.current;
        if (!g) return;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (!g.locked) {
          const axis = swipeAxis(dx, dy);
          if (!axis) return;
          // Vertical first: this is a scroll, so hand the gesture back to the browser.
          if (axis === "vertical") {
            gesture.current = null;
            return;
          }
          g.locked = true;
          setDragging(true);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Synthetic or already-ended pointers cannot be captured; the drag still works without it.
          }
        }
        setOffset(clampRowOffset(dx, g.width, directions));
      },
      onPointerUp(e: PointerEvent<HTMLElement>) {
        const g = gesture.current;
        reset();
        if (!g?.locked) return;
        // The click that follows a drag must not open the row.
        swiped.current = true;
        setTimeout(() => {
          swiped.current = false;
        }, 100);
        const outcome = rowSwipeOutcome(e.clientX - g.x, e.clientY - g.y, g.width, directions);
        if (outcome) onOutcome(outcome);
      },
      onPointerCancel: reset,
      onClickCapture(e: MouseEvent<HTMLElement>) {
        if (!swiped.current) return;
        e.preventDefault();
        e.stopPropagation();
      },
    },
  };
}
