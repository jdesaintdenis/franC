// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { bankExportFormat } from "./formats/bank-export";
import { buildSampleExport } from "./sample-export";

describe("synthetic sample export", () => {
  it("is exactly what the generator writes (run `pnpm sample:generate` after changing it)", () => {
    const committed = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "latin1");
    expect(committed).toBe(buildSampleExport());
  });

  it("parses with no error and starts with the telecom, salary, cash and savings rows", () => {
    const result = bankExportFormat.parse(buildSampleExport());
    if (!result.ok) throw new Error(result.fileError);
    expect(result.transactions).toHaveLength(140);
    expect(result.errors).toEqual([]);
    expect(result.transactions.slice(0, 4).map((t) => t.labelRaw)).toEqual([
      "PRLV HORIZON TELECOM",
      "VIR SEPA ATELIER LUMEN SAS",
      "RETRAIT DAB 29-09-10001-200001",
      "VIR. VERS LIVRET EPARGNE",
    ]);
  });
});
