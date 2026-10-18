import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { auth } from "./server";

export interface SavedPreferences {
  locale: string | null;
}

const NONE: SavedPreferences = { locale: null };

/**
 * Language saved on the signed-in user, from the one session lookup
 * per request. Login pages call this too, so a missing/invalid session must
 * never redirect or throw: it just means "no saved preference".
 */
export const savedPreferences = cache(async (): Promise<SavedPreferences> => {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NONE;
    return { locale: session.user.locale ?? null };
  } catch {
    return NONE;
  }
});
