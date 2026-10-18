import { describe, expect, it } from "vitest";

import { shiftSampleToMonth } from "./shift-sample-dates";

const HEADER = "Date de comptabilisation;Libelle simplifie;Date operation;x;y;z;a;b;c;d;Date operation 2;Date de valeur";
const row = (booking: string) => `${booking};LABEL;;;;;;;;;${booking};${booking}`;

describe("shiftSampleToMonth", () => {
  it("moves all three date columns by whole months", () => {
    const out = shiftSampleToMonth([HEADER, row("30/09/2025")].join("\n"), "2026-10-31");
    expect(out.split("\n")[1]).toBe("30/10/2026;LABEL;;;;;;;;;30/10/2026;30/10/2026");
  });

  it("clamps the day to the target month's length", () => {
    const csv = [HEADER, row("15/09/2025"), row("31/08/2025")].join("\n");
    const out = shiftSampleToMonth(csv, "2026-10-31").split("\n");
    expect(out[2].startsWith("30/09/2026")).toBe(true);
  });

  it("drops rows after today, keeps the header and line ending", () => {
    const csv = [HEADER, row("30/09/2025"), row("18/09/2025")].join("\r\n");
    const out = shiftSampleToMonth(csv, "2026-10-18").split("\r\n");
    expect(out[0]).toBe(HEADER);
    expect(out).toHaveLength(3); // header, kept row, trailing empty
    expect(out[1].startsWith("18/10/2026")).toBe(true);
  });
});
