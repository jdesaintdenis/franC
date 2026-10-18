import { z } from "zod";

import { normalizeLabel } from "../import/normalize-label";

export const MERCHANT_NAME_MAX = 60;
export const MERCHANT_PATTERN_MAX = 200;

/** Error messages are codes, translated at the UI edge. */
export const MERCHANT_INPUT_ERRORS = {
  nameRequired: "merchant_name_required",
  nameTooLong: "merchant_name_too_long",
  patternRequired: "merchant_pattern_required",
  patternTooLong: "merchant_pattern_too_long",
  matchTypeInvalid: "merchant_match_type_invalid",
} as const;

export const merchantNameSchema = z
  .string()
  .trim()
  .min(1, MERCHANT_INPUT_ERRORS.nameRequired)
  .max(MERCHANT_NAME_MAX, MERCHANT_INPUT_ERRORS.nameTooLong);

export const merchantMatchTypeSchema = z.enum(["contains", "starts_with", "equals"], {
  error: MERCHANT_INPUT_ERRORS.matchTypeInvalid,
});

export const merchantPatternSchema = z
  .string()
  .trim()
  .min(1, MERCHANT_INPUT_ERRORS.patternRequired)
  .max(MERCHANT_PATTERN_MAX, MERCHANT_INPUT_ERRORS.patternTooLong)
  // A pattern of only marks or spaces normalizes to "" and would never match.
  .refine((v) => normalizeLabel(v) !== "", MERCHANT_INPUT_ERRORS.patternRequired);

const uuid = z.uuid();

export const createMerchantSchema = z.object({
  name: merchantNameSchema,
  matchType: merchantMatchTypeSchema,
  pattern: merchantPatternSchema,
});

export const renameMerchantSchema = z.object({ merchantId: uuid, name: merchantNameSchema });

export const addPatternSchema = z.object({
  merchantId: uuid,
  matchType: merchantMatchTypeSchema,
  pattern: merchantPatternSchema,
});

/** What Undo sends back after a delete; the server checks it like any other input. */
export const merchantSnapshotSchema = z.object({
  id: uuid,
  name: merchantNameSchema,
  createdAt: z.iso.datetime(),
  patterns: z
    .array(
      z.object({
        id: uuid,
        matchType: merchantMatchTypeSchema,
        pattern: merchantPatternSchema,
        createdAt: z.iso.datetime(),
      }),
    )
    .max(200),
});

export const patternPreviewSchema = z.object({
  matchType: merchantMatchTypeSchema,
  pattern: merchantPatternSchema,
});

export type CreateMerchantData = z.infer<typeof createMerchantSchema>;
export type AddPatternData = z.infer<typeof addPatternSchema>;
