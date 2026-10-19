/**
 * UTF-8 first, Windows-1252 when the bytes are not valid UTF-8. Banks that export CSV for a French
 * Excel often write Windows-1252 (Latin-1 accents), others write UTF-8; invalid UTF-8 is a reliable
 * tell, and Windows-1252 maps every byte, so the fallback cannot fail.
 */
export function decodeUpload(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
