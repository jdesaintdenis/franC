"use client";

import { useEffect, useRef, useState } from "react";

export interface ChartSelection<K extends string> {
  /** Sticky selection, set by a touch tap. */
  selectedKey: K | null;
  /** Transient mouse hover (never set by touch). */
  hoverKey: K | null;
  /** Selection wins over hover. */
  activeKey: K | null;
  /** True for mouse input, and before any pointer event is seen. */
  isMouse: boolean;
  /** Wrap chart AND readout in this: a tap outside it clears the selection. */
  attachContainer: (node: HTMLDivElement | null) => void;
  /** Spread on the chart's wrapper element. */
  chartProps: {
    onPointerOver: (e: React.PointerEvent) => void;
    onPointerDown: (e: React.PointerEvent) => void;
    onClick: () => void;
  };
  /** Call from a mark's click, with its event (stops the chart-level "tap off a mark" handler): the mouse runs `onMouse` (navigate), touch toggles the selection. */
  itemClick: (key: K, event: { stopPropagation: () => void }, onMouse?: () => void) => void;
  /** Mouse hover only; ignored for touch. */
  hover: (key: K | null) => void;
  /** For keyboard focus on a mirrored list, which is not pointer input. */
  setHoverKey: (key: K | null) => void;
  clear: () => void;
}

/**
 * Shared touch/mouse logic of the charts. The input type comes from pointer events, not the
 * screen size, so a touch laptop behaves by what is actually used. On the mouse a hover shows
 * details and a click goes deeper; on touch a tap only selects (a slip of the finger never
 * navigates), tapping the same mark again, tapping outside or pressing Escape clears it.
 */
export function useChartSelection<K extends string>(): ChartSelection<K> {
  const [selectedKey, setSelectedKey] = useState<K | null>(null);
  const [hoverKey, setHoverKey] = useState<K | null>(null);
  const [isMouse, setIsMouse] = useState(true);
  // Handlers read the ref: a tap's click can run before the re-render that follows its pointerdown,
  // and a stale "mouse" there would navigate instead of selecting.
  const mouseRef = useRef(true);
  // State, not a ref: the node is only needed by the effect below.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  // A click, not a pointerdown: a finger starting a scroll sends pointerdown but never click, so
  // scrolling keeps the selection. Capture phase so a mark elsewhere that stops propagation still clears it.
  useEffect(() => {
    if (!selectedKey) return;
    function onDocumentClick(e: MouseEvent) {
      if (!container?.contains(e.target as Node)) setSelectedKey(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedKey(null);
    }
    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocumentClick, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedKey, container]);

  function notePointer(e: React.PointerEvent) {
    const mouse = e.pointerType === "mouse";
    mouseRef.current = mouse;
    setIsMouse(mouse);
    if (!mouse) setHoverKey(null);
  }

  return {
    selectedKey,
    hoverKey,
    activeKey: selectedKey ?? hoverKey,
    isMouse,
    attachContainer: setContainer,
    chartProps: {
      // Only a press sets the input type: after a tap Chrome sends a "mouse" pointerover to the
      // tapped point, which would turn the tap's click into a navigation.
      onPointerOver: (e) => {
        if (e.pointerType !== "mouse") setHoverKey(null);
      },
      onPointerDown: notePointer,
      // Marks stop their clicks, so one that reaches here is a tap on the chart but off every mark.
      onClick: () => {
        if (!mouseRef.current) setSelectedKey(null);
      },
    },
    itemClick: (key, event, onMouse) => {
      event.stopPropagation();
      if (mouseRef.current) onMouse?.();
      else setSelectedKey((current) => (current === key ? null : key));
    },
    hover: (key) => {
      if (mouseRef.current) setHoverKey(key);
    },
    setHoverKey,
    clear: () => setSelectedKey(null),
  };
}
