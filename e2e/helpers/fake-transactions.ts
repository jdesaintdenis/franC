import { isoDaysAgo } from "./dates";

// Synthetic transactions the fake Enable Banking serves for every linked account, shaped like the
// real bank (SPEC.md section 62): only booking_date (never transaction_date or value_date, except
// the one row that has a value date alone), a single remittance line equal to the CSV long label
// with a trailing card reference after "FACT ddmmyy", an entry_reference on every row (one of them
// the placeholder "0"), a bank_transaction_code and a status. Dates are relative to today so they
// always fall in the 90-day window. Two pages: the sync must follow the continuation key.

type FakeTransaction = Record<string, unknown>;

export function fakeTransactionPages(): FakeTransaction[][] {
  return [
    [
      {
        entry_reference: "FAKE-0001",
        transaction_amount: { amount: "5.88", currency: "EUR" },
        credit_debit_indicator: "DBIT",
        status: "BOOK",
        booking_date: isoDaysAgo(2),
        bank_transaction_code: { code: "PMNT" },
        remittance_information: [`CB BOULANGERIE DES L FACT ${ddmmyy(isoDaysAgo(3))} 4000XXXX1234`],
      },
      {
        entry_reference: "0",
        transaction_amount: { amount: "66.50", currency: "EUR" },
        credit_debit_indicator: "DBIT",
        status: "BOOK",
        booking_date: isoDaysAgo(5),
        bank_transaction_code: { code: "PMNT" },
        remittance_information: ["PRLV ORANGE BOX"],
      },
    ],
    [
      {
        entry_reference: "FAKE-0003",
        transaction_amount: { amount: "2000.00", currency: "EUR" },
        credit_debit_indicator: "CRDT",
        status: "BOOK",
        value_date: isoDaysAgo(6),
        bank_transaction_code: { code: "PMNT" },
        remittance_information: ["VIR SEPA ATELIER LUMEN"],
      },
      {
        entry_reference: "FAKE-0004",
        transaction_amount: { amount: "12.40", currency: "EUR" },
        credit_debit_indicator: "DBIT",
        status: "PDNG",
        booking_date: isoDaysAgo(0),
        bank_transaction_code: { code: "PMNT" },
        remittance_information: [`CB SUPER U FACT ${ddmmyy(isoDaysAgo(0))} 1234XXXX9999`],
      },
    ],
  ];
}

function ddmmyy(iso: string): string {
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;
}
