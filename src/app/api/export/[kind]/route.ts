import { getLocale, getTranslations } from "next-intl/server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { db } from "@/db/client";
import { exportBudgets, exportCategories, exportRules, exportTransactions } from "@/db/queries/export";
import { asLocale } from "@/i18n/config";
import { requireUser } from "@/lib/auth/session";
import type { CsvCell } from "@/lib/export/csv";
import { toCsv } from "@/lib/export/csv";
import {
  BUDGET_COLUMNS,
  budgetLines,
  CATEGORY_COLUMNS,
  categoryLines,
  EXPORT_KINDS,
  RULE_COLUMNS,
  ruleLines,
  type ExportKind,
} from "@/lib/export/files";
import { exportFormat } from "@/lib/export/format";
import { TRANSACTION_COLUMNS, transactionLines } from "@/lib/export/transactions";
import { parseTransactionFilters } from "@/lib/transactions/filters";

const kindSchema = z.enum(EXPORT_KINDS);

/** Server-local calendar date as YYYY-MM-DD (en-CA formats that way, without a Date shift). */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function GET(request: Request, ctx: RouteContext<"/api/export/[kind]">): Promise<Response> {
  const parsed = kindSchema.safeParse((await ctx.params).kind);
  if (!parsed.success) return new Response(null, { status: 404 });
  const kind: ExportKind = parsed.data;

  try {
    const user = await requireUser();
    const locale = asLocale(await getLocale());
    const t = await getTranslations("export");
    const { delimiter, decimalSeparator } = exportFormat(locale);

    let columns: readonly string[];
    let rows: CsvCell[][];
    switch (kind) {
      case "transactions": {
        const params = Object.fromEntries(new URL(request.url).searchParams);
        const items = await exportTransactions(db, user.id, parseTransactionFilters(params));
        columns = TRANSACTION_COLUMNS;
        rows = transactionLines(items, decimalSeparator, {
          categorySource: (code) => t(`categorySource.${code}`),
        });
        break;
      }
      case "categories":
        columns = CATEGORY_COLUMNS;
        rows = categoryLines(await exportCategories(db, user.id));
        break;
      case "rules":
        columns = RULE_COLUMNS;
        rows = ruleLines(await exportRules(db, user.id), { matchType: (code) => t(`matchType.${code}`) });
        break;
      case "budgets":
        columns = BUDGET_COLUMNS;
        rows = budgetLines(await exportBudgets(db, user.id), decimalSeparator, {
          yesNo: (value) => t(value ? "yesNo.yes" : "yesNo.no"),
        });
        break;
    }
    const header = columns.map((c) => t(`columns.${kind}.${c}` as never));

    return new Response(toCsv(header, rows, { delimiter }), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="franc-${kind}-${today()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // Lets requireUser's redirect to /login through; anything else is a bare 500 (never logged:
    // the data is financial).
    unstable_rethrow(error);
    return new Response(null, { status: 500 });
  }
}
