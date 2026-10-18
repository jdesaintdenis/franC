// Rewrites docs/samples/sample-export.csv from the seeded generator. Usage: pnpm sample:generate
import { writeFileSync } from "node:fs";

import { buildSampleExport } from "../src/lib/import/sample-export";

writeFileSync("docs/samples/sample-export.csv", buildSampleExport());
