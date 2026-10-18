"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface SelectionState {
  selectionMode: boolean;
  setSelectionMode: (on: boolean) => void;
}

const SelectionContext = createContext<SelectionState | null>(null);

/**
 * Selection mode lives above both the page header's ⋯ menu and the list, so the menu can turn it
 * on while the list owns what is checked.
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectionMode, setSelectionMode] = useState(false);
  return <SelectionContext.Provider value={{ selectionMode, setSelectionMode }}>{children}</SelectionContext.Provider>;
}

export function useSelectionMode(): SelectionState {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("useSelectionMode needs a SelectionProvider");
  return value;
}
