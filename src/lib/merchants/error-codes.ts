import type { MerchantWriteError } from "../../db/queries/merchants";
import { MERCHANT_INPUT_ERRORS } from "./input";

/** Keys of `merchant.errors` in the transactions and settings message namespaces. */
export type MerchantErrorCode =
  | "nameRequired"
  | "nameTooLong"
  | "patternRequired"
  | "patternTooLong"
  | "matchTypeInvalid"
  | "nameTaken"
  | "patternExists"
  | "notFound"
  | "invalidInput"
  | "saveFailed";

const INPUT_CODES: Record<string, MerchantErrorCode> = {
  [MERCHANT_INPUT_ERRORS.nameRequired]: "nameRequired",
  [MERCHANT_INPUT_ERRORS.nameTooLong]: "nameTooLong",
  [MERCHANT_INPUT_ERRORS.patternRequired]: "patternRequired",
  [MERCHANT_INPUT_ERRORS.patternTooLong]: "patternTooLong",
  [MERCHANT_INPUT_ERRORS.matchTypeInvalid]: "matchTypeInvalid",
};

/** Code for the first Zod issue; anything unexpected (bad uuid, wrong type) is `invalidInput`. */
export function merchantInputErrorCode(issues: readonly { message: string }[]): MerchantErrorCode {
  return INPUT_CODES[issues[0]?.message ?? ""] ?? "invalidInput";
}

const WRITE_CODES = {
  not_found: "notFound",
  name_taken: "nameTaken",
  pattern_exists: "patternExists",
} as const satisfies Record<MerchantWriteError, MerchantErrorCode>;

export function merchantWriteErrorCode(error: MerchantWriteError): MerchantErrorCode {
  return WRITE_CODES[error];
}
