"use client";

import { useEffect, useState, type ComponentProps } from "react";

import { takeSharedFile } from "@/lib/import/shared-file";

import { ImportFlow } from "./import-flow";

/**
 * The import flow when the page was opened from the share sheet: the file the
 * service worker parked is taken out of the cache (and deleted) before the flow
 * mounts, so its preview starts right away. Nothing parked: the normal drop zone.
 */
export function SharedImportFlow(props: Omit<ComponentProps<typeof ImportFlow>, "initialFile">) {
  const [shared, setShared] = useState<{ file: File | null } | null>(null);

  useEffect(() => {
    let active = true;
    void takeSharedFile().then((file) => {
      if (active) setShared({ file });
    });
    return () => {
      active = false;
    };
  }, []);

  if (shared === null) return <div aria-busy="true" className="min-h-40" />;
  return <ImportFlow {...props} initialFile={shared.file} />;
}
