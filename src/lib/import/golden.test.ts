// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { prepareImport } from "./index";

// Locks what the sample export parses to, dedupe hashes included: a re-import of a real file must
// keep finding its old rows, whatever parser reads it.
const FIXTURE = join(process.cwd(), "src/lib/import/fixtures/sample-export.parsed.json");
const ACCOUNT = "00000000-0000-4000-8000-000000000001";

describe("sample export golden output", () => {
  it("matches the recorded rows and dedupe keys", () => {
    const text = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "latin1");
    const r = prepareImport(text, ACCOUNT);
    if (!r.ok) throw new Error(r.fileError);
    if (process.env.RECORD_GOLDEN === "1") writeFileSync(FIXTURE, JSON.stringify(r.transactions, null, 1) + "\n");
    expect(r.transactions).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
});
