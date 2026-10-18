// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decodeUpload } from "./decode";

// "Libellé;Débit\r\n" as the bank writes it: é is the single byte 0xE9.
const latin1 = new Uint8Array([
  0x4c, 0x69, 0x62, 0x65, 0x6c, 0x6c, 0xe9, 0x3b, 0x44, 0xe9, 0x62, 0x69, 0x74, 0x0d, 0x0a,
]);

describe("decodeUpload", () => {
  it("decodes Windows-1252 accents from a Uint8Array", () => {
    expect(decodeUpload(latin1)).toBe("Libellé;Débit\r\n");
  });

  it("decodes from an ArrayBuffer", () => {
    const buffer = latin1.buffer.slice(latin1.byteOffset, latin1.byteOffset + latin1.byteLength);
    expect(decodeUpload(buffer)).toBe("Libellé;Débit\r\n");
  });

  it("decodes Windows-1252-specific characters (0x80–0x9F range)", () => {
    expect(decodeUpload(new Uint8Array([0x80, 0x20, 0x9c, 0x92]))).toBe("€ œ’");
  });

  it("decodes plain ASCII unchanged", () => {
    expect(decodeUpload(new TextEncoder().encode("Date;Debit\r\n"))).toBe("Date;Debit\r\n");
  });
});
