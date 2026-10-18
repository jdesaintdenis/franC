/**
 * Hand-off for CSV files shared to the installed app (manifest `share_target`).
 * The service worker receives the share POST and parks the file here; the import
 * page takes it out and deletes it at once, so a bank export only sits in Cache
 * Storage between the share and the page reading it.
 */
export const SHARE_TARGET_PATH = "/import/share";
export const SHARE_CACHE = "share-target";
export const SHARED_FILE_KEY = "/import/shared-file";
/** Query flag the service worker adds when it redirects to the import page. */
export const SHARED_PARAM = "shared";
export const SHARED_FILENAME_HEADER = "X-Shared-Filename";

/** Reads the shared file, if any, and removes it from the cache. Browser only. */
export async function takeSharedFile(): Promise<File | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const response = await cache.match(SHARED_FILE_KEY);
    await caches.delete(SHARE_CACHE);
    if (!response) return null;
    const name = decodeURIComponent(response.headers.get(SHARED_FILENAME_HEADER) ?? "export.csv");
    const blob = await response.blob();
    return new File([blob], name, { type: blob.type || "text/csv" });
  } catch {
    return null;
  }
}
