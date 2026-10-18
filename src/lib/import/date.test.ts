// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseFrDate } from "./date";

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
