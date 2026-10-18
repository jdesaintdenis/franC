import { ACCOUNT_NAME_MAX_LENGTH } from "../accounts/name";

/** What a bank account feeds: an existing franC account, a new one, or nothing. */
export type LinkChoice =
  | { kind: "existing"; accountId: string }
  | { kind: "new"; name: string }
  | { kind: "skip" };

export interface BankAccountForLink {
  uid: string;
  displayName: string;
}

export interface FrancAccountForLink {
  id: string;
  name: string;
  /** Already fed by another bank account, so it can't be offered again. */
  linked: boolean;
}

const fold = (s: string) => s.trim().toLocaleLowerCase("fr");

/** A name for a new account that doesn't clash (case-insensitively) with the user's accounts. */
export function uniqueAccountName(wanted: string, taken: readonly string[]): string {
  const used = new Set(taken.map(fold));
  const base = wanted.trim().slice(0, ACCOUNT_NAME_MAX_LENGTH) || "Account";
  if (!used.has(fold(base))) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = base.slice(0, ACCOUNT_NAME_MAX_LENGTH - suffix.length) + suffix;
    if (!used.has(fold(candidate))) return candidate;
  }
}

/**
 * Pre-selected choice per bank account (SPEC §61): the franC account with the same name; else, when
 * the user has exactly one free account, that one for the first bank account; else a new account
 * named after the bank's. Each franC account is proposed once.
 */
export function defaultLinkChoices(
  bankAccounts: readonly BankAccountForLink[],
  francAccounts: readonly FrancAccountForLink[],
): Map<string, LinkChoice> {
  const free = francAccounts.filter((a) => !a.linked);
  const claimed = new Set<string>();
  const choices = new Map<string, LinkChoice>();

  for (const bank of bankAccounts) {
    const sameName = free.find((a) => !claimed.has(a.id) && fold(a.name) === fold(bank.displayName));
    if (sameName) {
      claimed.add(sameName.id);
      choices.set(bank.uid, { kind: "existing", accountId: sameName.id });
    }
  }

  if (free.length === 1 && !claimed.has(free[0].id)) {
    const first = bankAccounts.find((b) => !choices.has(b.uid));
    if (first) {
      claimed.add(free[0].id);
      choices.set(first.uid, { kind: "existing", accountId: free[0].id });
    }
  }

  const names = francAccounts.map((a) => a.name);
  for (const bank of bankAccounts) {
    if (choices.has(bank.uid)) continue;
    const name = uniqueAccountName(bank.displayName, names);
    names.push(name);
    choices.set(bank.uid, { kind: "new", name });
  }
  return choices;
}

/** Last 4 characters of an IBAN, for display; never more is stored. */
export function ibanLast4(iban: string | null | undefined): string | null {
  const compact = iban?.replace(/\s+/g, "") ?? "";
  return compact.length >= 4 ? compact.slice(-4) : null;
}

export interface ReconnectAccount {
  bankAccountUid: string;
  identificationHash: string | null;
  ibanLast4: string | null;
  displayName: string;
}

/**
 * Pairs the accounts of a new bank session with the links of the connection it replaces, strictest
 * evidence first: the same uid, else the same identification hash, else the same IBAN end and name.
 * Returns new bank account uid → old link id; each side is used at most once.
 */
export function matchReconnectedAccounts<O extends ReconnectAccount & { id: string }>(
  oldLinks: readonly O[],
  newAccounts: readonly ReconnectAccount[],
): Map<string, string> {
  const matches = new Map<string, string>();
  const used = new Set<string>();
  const rules: Array<(o: O, n: ReconnectAccount) => boolean> = [
    (o, n) => o.bankAccountUid === n.bankAccountUid,
    (o, n) => o.identificationHash !== null && o.identificationHash === n.identificationHash,
    (o, n) => o.ibanLast4 !== null && o.ibanLast4 === n.ibanLast4 && fold(o.displayName) === fold(n.displayName),
  ];
  for (const rule of rules) {
    for (const n of newAccounts) {
      if (matches.has(n.bankAccountUid)) continue;
      const old = oldLinks.find((o) => !used.has(o.id) && rule(o, n));
      if (old) {
        matches.set(n.bankAccountUid, old.id);
        used.add(old.id);
      }
    }
  }
  return matches;
}
