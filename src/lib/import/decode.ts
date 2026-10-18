/**
 * The supported bank export is Windows-1252 (Latin-1 accents in labels), not UTF-8.
 * No encoding detection: this is the format's encoding, like its delimiter.
 * Windows-1252 maps every byte to a character, so decoding cannot fail.
 */
export function decodeUpload(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder("windows-1252").decode(bytes);
}
