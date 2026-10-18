/**
 * The account the import page preselects: the one used by the latest import,
 * else the first. A last-used id that is no longer in the list (deleted) is ignored.
 */
export function pickDefaultAccountId(accounts: readonly { id: string }[], lastUsedId: string | null): string {
  if (lastUsedId !== null && accounts.some((a) => a.id === lastUsedId)) return lastUsedId;
  return accounts[0]?.id ?? "";
}
