import { z } from "zod";

// Loose objects: the API may add fields and we only depend on the ones below.
export const aspspSchema = z.looseObject({
  name: z.string(),
  country: z.string(),
  logo: z.string().nullish(),
  maximum_consent_validity: z.number().nullish(),
  psu_types: z.array(z.string()).optional(),
});

export const aspspsResponseSchema = z.looseObject({ aspsps: z.array(aspspSchema) });

export const authResponseSchema = z.looseObject({
  url: z.string().url(),
  authorization_id: z.string().optional(),
});

const bankAccountSchema = z.looseObject({
  uid: z.string(),
  account_id: z.looseObject({ iban: z.string().nullish() }).nullish(),
  name: z.string().nullish(),
  product: z.string().nullish(),
  currency: z.string().nullish(),
  cash_account_type: z.string().nullish(),
  identification_hash: z.string().nullish(),
});

const rawSessionSchema = z.looseObject({
  session_id: z.string(),
  accounts: z.array(z.union([z.string(), bankAccountSchema])),
  accounts_data: z.array(bankAccountSchema).optional(),
  access: z.looseObject({ valid_until: z.string().optional() }).optional(),
  aspsp: z.looseObject({ name: z.string(), country: z.string() }).optional(),
});

/** Some API versions return account uids as strings with details in `accounts_data`; always yield objects. */
export const sessionResponseSchema = rawSessionSchema.transform((raw) => {
  const { accounts, accounts_data, ...rest } = raw;
  const isStrings = accounts.every((a): a is string => typeof a === "string");
  let normalized: z.infer<typeof bankAccountSchema>[];
  if (isStrings && accounts_data) normalized = accounts_data;
  else
    normalized = accounts.map((a) => (typeof a === "string" ? { uid: a } : a));
  return { ...rest, accounts: normalized };
});

export type Aspsp = z.infer<typeof aspspSchema>;
export type AspspsResponse = z.infer<typeof aspspsResponseSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type BankAccount = z.infer<typeof bankAccountSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

const partySchema = z.looseObject({ name: z.string().nullish() });

/** One transaction as Enable Banking sends it. Everything is optional: banks fill different fields. */
export const bankTransactionSchema = z.looseObject({
  entry_reference: z.string().nullish(),
  transaction_id: z.string().nullish(),
  transaction_amount: z.looseObject({
    // A decimal string per the API; a number is tolerated and kept as written.
    amount: z.union([z.string(), z.number()]).transform(String),
    currency: z.string(),
  }),
  credit_debit_indicator: z.string().nullish(),
  status: z.string().nullish(),
  booking_date: z.string().nullish(),
  value_date: z.string().nullish(),
  transaction_date: z.string().nullish(),
  remittance_information: z.array(z.string()).nullish(),
  creditor: partySchema.nullish(),
  debtor: partySchema.nullish(),
  bank_transaction_code: z
    .looseObject({ description: z.string().nullish(), code: z.string().nullish(), sub_code: z.string().nullish() })
    .nullish(),
  note: z.string().nullish(),
});

export const transactionsResponseSchema = z.looseObject({
  transactions: z.array(bankTransactionSchema),
  continuation_key: z.string().nullish(),
});

export type BankTransaction = z.infer<typeof bankTransactionSchema>;

export const bankBalanceSchema = z.looseObject({
  balance_amount: z.looseObject({
    // A decimal string per the API; a number is tolerated and kept as written.
    amount: z.union([z.string(), z.number()]).transform(String),
    currency: z.string(),
  }),
  balance_type: z.string(),
  reference_date: z.string().nullish(),
  last_change_date_time: z.string().nullish(),
  name: z.string().nullish(),
});

export const balancesResponseSchema = z.looseObject({ balances: z.array(bankBalanceSchema) });

export type BankBalance = z.infer<typeof bankBalanceSchema>;
