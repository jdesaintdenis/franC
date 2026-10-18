"use client";

import { useRef, useState, type PointerEvent } from "react";

import { swipeAxis, swipeOutcome } from "@/lib/review/swipe";

interface Options {
  onReviewed: () => void;
  onSkip: () => void;
  disabled?: boolean;
}

interface Gesture {
  x: number;
  y: number;
  width: number;
  locked: boolean;
}

// Buttons and fields keep their own behaviour: a drag that starts on one is never a swipe.
const INTERACTIVE = "select,button,a,input,textarea,label,summary";

/**
 * Horizontal swipe on touch and pen input (a mouse never swipes). The element must have
 * `touch-action: pan-y` so the browser keeps vertical scrolling and leaves horizontal moves to us.
 */
export function useSwipe({ onReviewed, onSkip, disabled = false }: Options) {
  const gesture = useRef<Gesture | null>(null);
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
        if (disabled || e.pointerType === "mouse" || !e.isPrimary) return;
        if ((e.target as Element).closest(INTERACTIVE)) return;
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
        setOffset(dx);
      },
      onPointerUp(e: PointerEvent<HTMLElement>) {
        const g = gesture.current;
        reset();
        if (!g?.locked) return;
        const outcome = swipeOutcome(e.clientX - g.x, e.clientY - g.y, g.width);
        if (outcome === "reviewed") onReviewed();
        else if (outcome === "skip") onSkip();
      },
      onPointerCancel: reset,
    },
  };
}
