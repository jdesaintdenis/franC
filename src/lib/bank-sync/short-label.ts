import { normalizeLabel } from "../import/normalize-label";

// The bank's API only sends the long label; the CSV's short label ("Libelle simplifie") is what
// people see and what rules and merchant names were written on, so synced rows need one too.

/** Labels the bank rewrites to its own fixed wording, whatever follows. */
const FIXED: ReadonlyArray<readonly [RegExp, string]> = [
  [/^RETRAIT DAB\b/i, "RETRAIT D'ESPECES"],
  [/^ECH PRET\b/i, "ECHEANCE DE CREDIT"],
];

// Longest alternatives first so `PRLV SEPA X` loses both words. `VIR.` (internal transfers) is left
// alone: the bank keeps it in the short label.
const PREFIX = /^(?:CB|PRLV SEPA|PRLV|VIR SEPA|VIR INST|VIR)\s+/i;

const SUFFIXES: readonly RegExp[] = [
  /\s+FACT\s+\d{6}$/i, // card payment: invoice date ddmmyy
  /\s+DU\s+\d{2}\/\d{2}\/\d{2,4}$/i,
  /\s+\d{2}[/.-]\d{2}(?:[/.-]\d{2,4})?$/, // a bare trailing date
];

/** The long label without the bank's wrapping (payment-type prefix, invoice date suffix). */
export function stripBankLabel(labelRaw: string): string {
  const label = labelRaw.trim().replace(/\s+/g, " ");
  for (const [pattern, wording] of FIXED) if (pattern.test(label)) return wording;
  let out = label.replace(PREFIX, "");
  for (const suffix of SUFFIXES) out = out.replace(suffix, "");
  out = out.trim();
  return out === "" ? label : out;
}

export type LearnedShortLabels = ReadonlyMap<string, string>;

/**
 * What past CSV rows teach: stripped long label → the short label the bank showed for it. The CSV
 * often completes a truncated name (`BOULANGERIE DES L` → `BOULANGERIE DES LILAS`) or renames it
 * (`AUTOROUTE A99 NORD` → `PEAGE AUTOROUTE`), which stripping alone can't guess. Most frequent wins,
 * the newest breaks a tie.
 */
export function learnShortLabels(
  rows: ReadonlyArray<{ labelRaw: string; labelSimplified: string; date: string }>,
): LearnedShortLabels {
  const stats = new Map<string, Map<string, { count: number; newest: string }>>();
  for (const row of rows) {
    const short = row.labelSimplified.trim();
    if (short === "") continue;
    const key = normalizeLabel(stripBankLabel(row.labelRaw));
    let byShort = stats.get(key);
    if (!byShort) stats.set(key, (byShort = new Map()));
    const seen = byShort.get(short);
    if (seen) {
      seen.count += 1;
      if (row.date > seen.newest) seen.newest = row.date;
    } else byShort.set(short, { count: 1, newest: row.date });
  }
  const learned = new Map<string, string>();
  for (const [key, byShort] of stats) {
    let best: { short: string; count: number; newest: string } | null = null;
    for (const [short, s] of byShort) {
      if (!best || s.count > best.count || (s.count === best.count && s.newest > best.newest)) best = { short, ...s };
    }
    if (best) learned.set(key, best.short);
  }
  return learned;
}

/** The short label for a synced row: what the CSVs taught for this merchant, else the stripped label. */
export function shortLabelFor(labelRaw: string, learned: LearnedShortLabels): string {
  const stripped = stripBankLabel(labelRaw);
  return learned.get(normalizeLabel(stripped)) ?? stripped;
}
