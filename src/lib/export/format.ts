import type { Locale } from "@/i18n/config";

export interface ExportFormat {
  delimiter: "," | ";";
  decimalSeparator: "." | ",";
}

/** Follows the language, so the file opens correctly in a spreadsheet set to that language. */
export function exportFormat(locale: Locale): ExportFormat {
  return locale === "fr" ? { delimiter: ";", decimalSeparator: "," } : { delimiter: ",", decimalSeparator: "." };
}
