// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseDateAs, parseFrDate } from "./date";

describe("parseFrDate", () => {
  it("converts valid dates without shifting the day", () => {
    expect(parseFrDate("29/09/2025")).toBe("2025-09-29");
    expect(parseFrDate("01/01/2025")).toBe("2025-01-01");
    expect(parseFrDate("31/12/2025")).toBe("2025-12-31");
  });

  it("accepts a leap day only in leap years", () => {
    expect(parseFrDate("29/02/2024")).toBe("2024-02-29");
    expect(parseFrDate("29/02/2025")).toBeNull();
    expect(parseFrDate("29/02/1900")).toBeNull();
    expect(parseFrDate("29/02/2000")).toBe("2000-02-29");
  });

  it.each(["31/04/2025", "00/01/2025", "01/13/2025", "2025-09-01", "1/1/2025", ""])(
    "rejects %j",
    (input) => {
      expect(parseFrDate(input)).toBeNull();
    },
  );
});

describe("parseDateAs", () => {
  it.each([
    ["30/09/2025", "DD/MM/YYYY", "2025-09-30"],
    ["1/9/2025", "DD/MM/YYYY", "2025-09-01"],
    ["30/09/25", "DD/MM/YY", "2025-09-30"],
    ["30-09-2025", "DD-MM-YYYY", "2025-09-30"],
    ["30.09.2025", "DD.MM.YYYY", "2025-09-30"],
    ["2025-09-30", "YYYY-MM-DD", "2025-09-30"],
    ["09/30/2025", "MM/DD/YYYY", "2025-09-30"],
    ["29/02/2024", "DD/MM/YYYY", "2024-02-29"],
  ] as const)("reads %s as %s", (input, format, expected) => {
    expect(parseDateAs(input, format)).toBe(expected);
  });

  it.each([
    ["31/02/2025", "DD/MM/YYYY"],
    ["29/02/2025", "DD/MM/YYYY"],
    ["2025-09-30", "DD/MM/YYYY"],
    ["30/13/2025", "DD/MM/YYYY"],
    ["", "YYYY-MM-DD"],
  ] as const)("rejects %j as %s", (input, format) => {
    expect(parseDateAs(input, format)).toBeNull();
  });
});
