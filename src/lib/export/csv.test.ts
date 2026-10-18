import { describe, expect, it } from "vitest";

import { number, text, toCsv } from "./csv";
import { exportFormat } from "./format";

const comma = { delimiter: "," } as const;
const semi = { delimiter: ";" } as const;

describe("toCsv", () => {
  it("starts with a BOM, then the header, CRLF after every line", () => {
    const out = toCsv(["a", "b"], [[text("x"), text("y")]], comma);
    expect(out).toBe("﻿a,b\r\nx,y\r\n");
  });

  it("writes only the header for no rows", () => {
    expect(toCsv(["a"], [], comma)).toBe("﻿a\r\n");
  });

  it("quotes a field with the delimiter, a quote or a newline, doubling quotes", () => {
    const out = toCsv(["h"], [[text("a,b")], [text('say "hi"')], [text("l1\nl2")], [text("l1\r\nl2")]], comma);
    expect(out).toBe('﻿h\r\n"a,b"\r\n"say ""hi"""\r\n"l1\nl2"\r\n"l1\r\nl2"\r\n');
  });

  it("only quotes on the active delimiter", () => {
    expect(toCsv(["h"], [[text("a,b")], [text("a;b")]], semi)).toBe('﻿h\r\na,b\r\n"a;b"\r\n');
  });

  it("keeps empty and space-only fields as is", () => {
    expect(toCsv(["h", "i"], [[text(""), text("   ")]], comma)).toBe("﻿h,i\r\n,   \r\n");
  });

  it.each(["=SUM(A1)", "+33612345678", "@x", "-foo", "\tx", "\rx"])("guards a formula-looking label %j", (label) => {
    const out = toCsv(["h"], [[text(label)]], comma);
    const body = out.slice(1 + "h\r\n".length);
    expect(body.startsWith(`'${label}`) || body.startsWith(`"'${label}`)).toBe(true);
  });

  it("guards then quotes when needed", () => {
    expect(toCsv(["h"], [[text("=A1,B1")]], comma)).toBe("﻿h\r\n\"'=A1,B1\"\r\n");
  });

  it("never guards a number cell, even a negative amount", () => {
    expect(toCsv(["h"], [[number("-66.50")]], comma)).toBe("﻿h\r\n-66.50\r\n");
  });

  it("does not guard a label that merely contains a formula character", () => {
    expect(toCsv(["h"], [[text("a=b")]], comma)).toBe("﻿h\r\na=b\r\n");
  });
});

describe("exportFormat", () => {
  it("follows the language", () => {
    expect(exportFormat("fr")).toEqual({ delimiter: ";", decimalSeparator: "," });
    expect(exportFormat("en")).toEqual({ delimiter: ",", decimalSeparator: "." });
  });
});
