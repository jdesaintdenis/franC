import { formattingLocale, type Locale } from "@/i18n/config";

/** Display only: a yearly rate given in thousandths of a percent, "1,5 %" / "1.5%" (up to three decimals). */
export function formatRate(thousandths: number, locale: Locale): string {
  return new Intl.NumberFormat(formattingLocale(locale), {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(thousandths / 100_000);
}

/** The same rate as text for a form field: "4,9" in French, "4.9" in English. Round-trips through `parseRateThousandths`. */
export function formatRateInput(thousandths: number, locale: Locale): string {
  const whole = Math.trunc(thousandths / 1000);
  const decimals = String(thousandths % 1000).padStart(3, "0").replace(/0+$/, "");
  return decimals ? `${whole}${locale === "fr" ? "," : "."}${decimals}` : String(whole);
}
