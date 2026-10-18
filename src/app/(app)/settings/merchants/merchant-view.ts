import type { MerchantMatchType } from "@/lib/merchants/match";

/** What the merchants screen needs of a merchant (plain data, passed from the server page). */
export interface MerchantView {
  id: string;
  name: string;
  transactionCount: number;
  patterns: { id: string; matchType: MerchantMatchType; pattern: string }[];
}
